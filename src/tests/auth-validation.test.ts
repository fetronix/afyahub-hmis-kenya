import {
  validateLoginInput,
  validateIdentifier,
  validatePassword,
  validateSessionToken,
  validateEmail,
  AuthValidationError,
} from "../auth/auth.validation";

function assert(
  condition: boolean,
  message: string
): void {
  if (!condition) {
    throw new Error(
      `ASSERTION FAILED: ${message}`
    );
  }

  console.log(`✓ ${message}`);
}

async function runValidationTests() {
  console.log("");
  console.log("==============================================");
  console.log("JaliCare HMIS - Authentication Validation Test");
  console.log("==============================================");
  console.log("");

  /*
  |--------------------------------------------------------------------------
  | TEST 1 — Valid Login
  |--------------------------------------------------------------------------
  */

  console.log(
    "TEST 1: Validating legitimate login request..."
  );

  const login = validateLoginInput({
    identifier: "admin",
    password: "ValidTestPassword123!",
    ipAddress: "127.0.0.1",
    userAgent: "JaliCare-Test",
  });

  assert(
    login.identifier === "admin",
    "Valid identifier accepted"
  );

  assert(
    login.password === "ValidTestPassword123!",
    "Valid password accepted"
  );

  /*
  |--------------------------------------------------------------------------
  | TEST 2 — Identifier Normalization
  |--------------------------------------------------------------------------
  */

  console.log("");
  console.log(
    "TEST 2: Testing identifier normalization..."
  );

  const identifier =
    validateIdentifier(
      "  ADMIN@JALICARE.CO.KE  "
    );

  assert(
    identifier === "admin@jalicare.co.ke",
    "Identifier is normalized"
  );

  /*
  |--------------------------------------------------------------------------
  | TEST 3 — Short Password
  |--------------------------------------------------------------------------
  */

  console.log("");
  console.log(
    "TEST 3: Rejecting short passwords..."
  );

  let rejected = false;

  try {
    validatePassword("short");
  } catch (error) {
    rejected =
      error instanceof AuthValidationError;
  }

  assert(
    rejected,
    "Short password is rejected"
  );

  /*
  |--------------------------------------------------------------------------
  | TEST 4 — Oversized Password
  |--------------------------------------------------------------------------
  */

  console.log("");
  console.log(
    "TEST 4: Rejecting oversized passwords..."
  );

  rejected = false;

  try {
    validatePassword(
      "A".repeat(129)
    );
  } catch (error) {
    rejected =
      error instanceof AuthValidationError;
  }

  assert(
    rejected,
    "Oversized password is rejected"
  );

  /*
  |--------------------------------------------------------------------------
  | TEST 5 — Missing Identifier
  |--------------------------------------------------------------------------
  */

  console.log("");
  console.log(
    "TEST 5: Rejecting missing identifier..."
  );

  rejected = false;

  try {
    validateIdentifier("");
  } catch (error) {
    rejected =
      error instanceof AuthValidationError;
  }

  assert(
    rejected,
    "Missing identifier is rejected"
  );

  /*
  |--------------------------------------------------------------------------
  | TEST 6 — Control Character
  |--------------------------------------------------------------------------
  */

  console.log("");
  console.log(
    "TEST 6: Rejecting control characters..."
  );

  rejected = false;

  try {
    validateIdentifier(
      "admin\nattack"
    );
  } catch (error) {
    rejected =
      error instanceof AuthValidationError;
  }

  assert(
    rejected,
    "Control characters are rejected"
  );

  /*
  |--------------------------------------------------------------------------
  | TEST 7 — Invalid Session Token
  |--------------------------------------------------------------------------
  */

  console.log("");
  console.log(
    "TEST 7: Rejecting invalid session tokens..."
  );

  rejected = false;

  try {
    validateSessionToken(
      "invalid-session-token"
    );
  } catch (error) {
    rejected =
      error instanceof AuthValidationError;
  }

  assert(
    rejected,
    "Invalid session token is rejected"
  );

  /*
  |--------------------------------------------------------------------------
  | TEST 8 — Valid Session Token
  |--------------------------------------------------------------------------
  */

  console.log("");
  console.log(
    "TEST 8: Accepting valid session-token format..."
  );

  const validToken =
    "A".repeat(64);

  const validatedToken =
    validateSessionToken(
      validToken
    );

  assert(
    validatedToken === validToken,
    "Valid session-token format is accepted"
  );

  /*
  |--------------------------------------------------------------------------
  | TEST 9 — Invalid Email
  |--------------------------------------------------------------------------
  */

  console.log("");
  console.log(
    "TEST 9: Rejecting invalid email..."
  );

  rejected = false;

  try {
    validateEmail(
      "not-an-email"
    );
  } catch (error) {
    rejected =
      error instanceof AuthValidationError;
  }

  assert(
    rejected,
    "Invalid email is rejected"
  );

  /*
  |--------------------------------------------------------------------------
  | TEST 10 — Valid Email
  |--------------------------------------------------------------------------
  */

  console.log("");
  console.log(
    "TEST 10: Validating legitimate email..."
  );

  const email =
    validateEmail(
      "  ADMIN@JALICARE.CO.KE "
    );

  assert(
    email === "admin@jalicare.co.ke",
    "Email is normalized"
  );

  /*
  |--------------------------------------------------------------------------
  | COMPLETE
  |--------------------------------------------------------------------------
  */

  console.log("");
  console.log(
    "=============================================="
  );
  console.log(
    "AUTHENTICATION VALIDATION TEST PASSED"
  );
  console.log(
    "=============================================="
  );
  console.log("");
}

runValidationTests()
  .catch((error) => {
    console.error("");
    console.error(
      "=============================================="
    );
    console.error(
      "AUTHENTICATION VALIDATION TEST FAILED"
    );
    console.error(
      "=============================================="
    );
    console.error("");
    console.error(error);
    console.error("");

    process.exitCode = 1;
  });