// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTable, PageBreadcrumbs } from '../../components/ui/layout.tsx';
import { FormField, Pagination, Tabs } from '../../components/ui/controls.tsx';
import { ConfirmationDialog, Drawer, DropdownMenu, Modal } from '../../components/ui/overlays.tsx';

afterEach(cleanup);

describe('shared staff interface primitives', () => {
  it('keeps native table headers, rows and accessible horizontal scrolling', () => {
    render(
      <DataTable aria-label="Synthetic records">
        <thead>
          <tr>
            <th scope="col">Name</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Example</td>
          </tr>
        </tbody>
      </DataTable>,
    );
    const table = screen.getByRole('table', { name: 'Synthetic records' });
    expect(within(table).getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: 'Example' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Scrollable data table' })).toHaveAttribute(
      'tabindex',
      '0',
    );
  });
  it('navigates breadcrumbs without changing the active page itself', async () => {
    const navigate = vi.fn();
    const user = userEvent.setup();
    render(
      <PageBreadcrumbs
        items={[{ label: 'Dashboard', onClick: navigate }, { label: 'Laboratory' }]}
      />,
    );
    expect(screen.getByText('Laboratory')).toHaveAttribute('aria-current', 'page');
    await user.click(screen.getByRole('button', { name: 'Dashboard' }));
    expect(navigate).toHaveBeenCalledOnce();
  });
  it('connects a visible form label and hint to a native control', () => {
    render(
      <FormField label="Reference" htmlFor="reference" hint="Optional" error="Check this reference">
        <input id="reference" aria-describedby="additional-context" />
      </FormField>,
    );
    expect(screen.getByLabelText('Reference')).toHaveAccessibleDescription(
      'Optional Check this reference',
    );
    expect(screen.getByLabelText('Reference')).toHaveAttribute(
      'aria-describedby',
      'additional-context reference-hint reference-error',
    );
    expect(screen.getByLabelText('Reference')).toHaveAttribute('aria-invalid', 'true');
  });
  it('moves focus and selection through enabled tabs with arrow keys', async () => {
    const user = userEvent.setup();
    function Example() {
      const [tab, setTab] = useState('one');
      return (
        <Tabs
          label="Sections"
          idPrefix="example"
          value={tab}
          onChange={setTab}
          items={[
            { id: 'one', label: 'One' },
            { id: 'disabled', label: 'Disabled', disabled: true },
            { id: 'two', label: 'Two' },
          ]}
        />
      );
    }
    render(<Example />);
    const first = screen.getByRole('tab', { name: 'One' });
    first.focus();
    await user.keyboard('{ArrowRight}');
    const second = screen.getByRole('tab', { name: 'Two' });
    expect(second).toHaveFocus();
    expect(second).toHaveAttribute('aria-selected', 'true');
    expect(second).toHaveAttribute('aria-controls', 'example-panel-two');
    await user.keyboard('{ArrowRight}');
    expect(first).toHaveFocus();
  });
  it('clamps previous-page navigation and disables unavailable pages', async () => {
    const onPageChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <Pagination offset={0} limit={10} total={15} onPageChange={onPageChange} />,
    );
    expect(screen.getByRole('button', { name: 'Previous results' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next results' }));
    expect(onPageChange).toHaveBeenCalledWith(10);
    rerender(<Pagination offset={10} limit={10} total={15} onPageChange={onPageChange} />);
    expect(screen.getByText('Showing 11–15 of 15')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next results' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Previous results' }));
    expect(onPageChange).toHaveBeenLastCalledWith(0);
  });
  it('traps focus in a modal, handles Escape and returns focus to its trigger', async () => {
    const user = userEvent.setup();
    function Example() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Open form</button>
          <Modal open={open} onClose={() => setOpen(false)} title="Example form">
            <label>
              Value
              <input />
            </label>
            <button>Last action</button>
          </Modal>
        </>
      );
    }
    render(<Example />);
    const trigger = screen.getByRole('button', { name: 'Open form' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Example form' });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    within(dialog).getByRole('button', { name: 'Last action' }).focus();
    await user.tab();
    expect(within(dialog).getByRole('button', { name: 'Close Example form' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
  it('does not dismiss or confirm a busy confirmation; a drawer is also a named dialog', async () => {
    const cancel = vi.fn(),
      confirm = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <ConfirmationDialog open title="Review" onCancel={cancel} onConfirm={confirm} busy>
        Confirm an action
      </ConfirmationDialog>,
    );
    await user.keyboard('{Escape}');
    expect(cancel).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close Review' })).toBeDisabled();
    rerender(
      <Drawer open title="Details" onClose={cancel}>
        Information
      </Drawer>,
    );
    expect(screen.getByRole('dialog', { name: 'Details' })).toHaveAttribute('aria-modal', 'true');
    await user.keyboard('{Escape}');
    expect(cancel).toHaveBeenCalledOnce();
    expect(confirm).not.toHaveBeenCalled();
  });
  it('supports keyboard navigation and Escape in a dropdown menu', async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu label="Actions">
        <button role="menuitem">First</button>
        <button role="menuitem">Second</button>
      </DropdownMenu>,
    );
    const trigger = screen.getByRole('button', { name: 'Actions' });
    await user.click(trigger);
    expect(screen.getByRole('menuitem', { name: 'First' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Second' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
