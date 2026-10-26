#!/usr/bin/env python3
"""Move route registrations out of src/app.ts into a router of their own.

Two ways to choose the block:

    extract-domain.py <name> <label> <next-label>
        From the banner above <label> up to the banner above <next-label>.

    extract-domain.py <name> --between <start-path> <end-path>
        From the registration of <start-path> (with its doc comment) up to
        the registration of <end-path>. Used where the banners do not
        describe the contents: "UNBILLED CHARGES" held billing, invoices,
        claims and the DHA integration under a single heading.

The text is moved, not rewritten: paths, handlers, permissions and comments
are byte-identical apart from the two-space de-indent that `app.` carried
inside `createApp` and the verb that changes from `app.` to `router.`.

Every move is checked three ways before anything is written: the selected
lines must be a sequence of complete statements (bracket depth returns to
zero), the first and last lines are printed for inspection, and the block
must appear exactly once in app.ts so the deletion cannot hit the wrong
copy.
"""

import re
import sys

APP = 'src/app.ts'
INDEX = 'src/routes/index.ts'

ROUTE_OPEN = re.compile(r'^  app\.(get|post|put|patch|delete)\(')


def read(path):
    with open(path) as f:
        return f.read()


def write(path, text):
    with open(path, 'w') as f:
        f.write(text)


# ---------------------------------------------------------------------------
# Imports
# ---------------------------------------------------------------------------


def parse_imports(src):
    """ident -> (module, kind, exported_name); kind is default|named|namespace|type."""
    table = {}

    for m in re.finditer(r"^import\s+([\s\S]*?)\s+from\s*'([^']+)';", src, re.M):
        clause, module = m.group(1), m.group(2)
        clause = ' '.join(clause.split())
        whole_type = clause.startswith('type ')
        clause = clause.removeprefix('type ').strip()

        ns = re.search(r'\*\s+as\s+(\w+)', clause)
        if ns:
            table[ns.group(1)] = (module, 'namespace', ns.group(1))
            continue

        braces = re.search(r'\{([^}]*)\}', clause)
        head = clause[: braces.start()].strip().rstrip(',').strip() if braces else clause.strip()

        if head and re.fullmatch(r'\w+', head):
            table[head] = (module, 'default', head)

        if braces:
            for raw in braces.group(1).split(','):
                member = raw.strip()

                if not member:
                    continue

                is_type = whole_type or member.startswith('type ')
                member = member.removeprefix('type ').strip()
                name, _, alias = member.partition(' as ')

                table[(alias or name).strip()] = (
                    module,
                    'type' if is_type else 'named',
                    name.strip(),
                )

    return table


def rebase(module):
    """app.ts sits in src/; the routers sit in src/routes/."""
    if module.startswith('./routes/'):
        return './' + module[len('./routes/') :]

    if module.startswith('./'):
        return '../' + module[2:]

    return module


def imports_for(block, table, skip, force=()):
    used = []

    for ident, info in table.items():
        if ident in skip:
            continue
        if ident in force or re.search(r'\b' + re.escape(ident) + r'\b', block):
            used.append((ident, info))

    by_module = {}

    for ident, info in used:
        by_module.setdefault(rebase(info[0]), []).append((ident, info))

    lines = []

    for module in sorted(by_module):
        entries = by_module[module]
        defaults = sorted(i for i, inf in entries if inf[1] == 'default')
        namespaces = sorted(i for i, inf in entries if inf[1] == 'namespace')
        values = sorted(
            f'{inf[2]} as {i}' if inf[2] != i else i
            for i, inf in entries
            if inf[1] == 'named'
        )
        types = sorted(
            f'{inf[2]} as {i}' if inf[2] != i else i
            for i, inf in entries
            if inf[1] == 'type'
        )

        for ns in namespaces:
            lines.append(f"import * as {ns} from '{module}';")

        if len(defaults) > 1:
            sys.exit(f'{module}: more than one default import')

        head = defaults[0] if defaults else ''
        braces = values + [f'type {t}' for t in types]

        if braces and len(', '.join(braces)) > 76:
            inner = ''.join(f'  {b},\n' for b in braces)

            if head:
                lines.append(f"import {head},\n{{\n{inner}}} from '{module}';")
            else:
                lines.append(f"import {{\n{inner}}} from '{module}';")

            continue

        if braces:
            rendered = ', '.join(braces)
            lines.append(
                f"import {head}, {{ {rendered} }} from '{module}';"
                if head
                else f"import {{ {rendered} }} from '{module}';"
            )
        elif head:
            lines.append(f"import {head} from '{module}';")

    return lines


# ---------------------------------------------------------------------------
# Selecting the block
# ---------------------------------------------------------------------------


def banner_start(lines, label):
    hits = [i for i, l in enumerate(lines) if l.strip() == f'// {label}']

    if len(hits) != 1:
        sys.exit(f'banner {label!r} found {len(hits)} times')

    i = hits[0]

    if i > 0 and lines[i - 1].strip().startswith('// ===='):
        return i - 1

    if i + 1 < len(lines) and lines[i + 1].strip().startswith('// ===='):
        return i

    sys.exit(f'banner {label!r} has no rule line')


def route_line_for(lines, path):
    hits = []

    for i, line in enumerate(lines):
        if not ROUTE_OPEN.match(line):
            continue

        j = i + 1
        while j < len(lines) and not lines[j].strip():
            j += 1

        if lines[j].strip().strip(',').strip("'") == path:
            hits.append(i)

    if len(hits) != 1:
        sys.exit(f'path {path!r} matched {len(hits)} registrations')

    return hits[0]


def comment_start(lines, index):
    """Walk up over the doc comment attached to the route at `index`."""
    start = index

    while start > 0:
        previous = lines[start - 1].strip()

        if previous.startswith(('//', '*', '/*')):
            start -= 1
            continue

        # One blank line may separate a comment block from what it documents.
        if previous == '' and start >= 2 and lines[start - 2].strip().startswith(('//', '*', '/*')):
            start -= 1
            continue

        break

    return start


def check_block(block, label):
    depth = 0

    for line in block:
        if ROUTE_OPEN.match(line) and depth != 0:
            sys.exit(f'{label}: a route starts inside an open statement: {line.strip()[:60]}')

        depth += line.count('(') + line.count('{') + line.count('[')
        depth -= line.count(')') + line.count('}') + line.count(']')

        if depth < 0:
            sys.exit(f'{label}: unbalanced closing bracket: {line.strip()[:60]}')

    if depth != 0:
        sys.exit(f'{label}: block ends {depth} brackets deep - it would cut a statement in half')

    if not any(ROUTE_OPEN.match(line) for line in block):
        sys.exit(f'{label}: no route registrations in the block')


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------


def write_module(name, block, src):
    ident = re.sub(r'-(\w)', lambda m: m.group(1).upper(), name) + 'Routes'

    text = '\n'.join(block)
    text = re.sub(r'^  app\.', 'router.', text, flags=re.M)
    text = '\n'.join(l[2:] if l.startswith('  ') else l for l in text.split('\n'))
    text = text.strip('\n')

    table = parse_imports(src)
    table['Router'] = ('express', 'named', 'Router')
    imported = imports_for(text, table, skip={'createApiRoutes'}, force=('Router',))

    header = (
        '/**\n'
        f' * The {name.replace("-", " ")} routes.\n'
        ' *\n'
        ' * Moved out of `createApp` unchanged: same paths, same handlers, same\n'
        ' * permissions. `src/routes/index.ts` mounts this router on the API router.\n'
        ' */\n\n'
        + '\n'.join(imported)
        + '\n\nconst router = Router();\n\n'
    )
    write(f'src/routes/{name}.routes.ts', header + text + '\n\nexport default router;\n')

    lines = src.split('\n')
    matches = [i for i in range(len(lines) - len(block) + 1) if lines[i : i + len(block)] == block]

    if len(matches) != 1:
        sys.exit(f'block matched {len(matches)} times in app.ts')

    at = matches[0]
    write(APP, '\n'.join(lines[:at] + lines[at + len(block) :]))

    index = read(INDEX)
    anchor = '  api.use(inpatientRoutes);'

    assert index.count(anchor) == 1, 'anchor for router registration not found'

    index = index.replace(anchor, anchor + f'\n  api.use({ident});')
    index = index.replace(
        "import inpatientRoutes from './inpatient.routes.ts';",
        f"import {ident} from './{name}.routes.ts';\n"
        "import inpatientRoutes from './inpatient.routes.ts';",
    )
    write(INDEX, index)

    print(f'{name}: {len(block)} lines moved')


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main():
    if len(sys.argv) == 5 and sys.argv[2] == '--between':
        name, start_path, end_path = sys.argv[1], sys.argv[3], sys.argv[4]
        src = read(APP)
        lines = src.split('\n')

        start = comment_start(lines, route_line_for(lines, start_path))

        # An end that is a banner label rather than a route, for blocks that
        # run to the next section: prefix it with '#'.
        end = (
            banner_start(lines, end_path[1:])
            if end_path.startswith('#')
            else comment_start(lines, route_line_for(lines, end_path))
        )

        if start >= end:
            sys.exit('the start routes after the end - check the arguments')

        block = lines[start:end]
        check_block(block, name)

        print(f'--- first 3 of {len(block)} lines')
        print('\n'.join(block[:3]))
        print('--- last 3')
        print('\n'.join(block[-3:]))

        write_module(name, block, src)

        return

    if len(sys.argv) != 4:
        sys.exit(__doc__)

    name, first, next_label = sys.argv[1], sys.argv[2], sys.argv[3]

    src = read(APP)
    lines = src.split('\n')

    start = banner_start(lines, first)
    end = banner_start(lines, next_label)

    if start >= end:
        sys.exit('the start banner comes after the end banner')

    block = lines[start:end]
    check_block(block, name)

    write_module(name, block, src)


if __name__ == '__main__':
    main()
