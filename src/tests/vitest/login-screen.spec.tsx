// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loginMock = vi.fn();

vi.mock('../../context/HmisContext.tsx', () => ({
  useHmis: () => ({
    login: loginMock,
  }),
}));

const { LoginScreen } = await import('../../components/LoginScreen.tsx');

beforeEach(() => {
  loginMock.mockReset();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('LoginScreen — JaliCare HMIS Login Portal', () => {
  it('renders the reference branding, service modules, login controls, and security footers', () => {
    render(<LoginScreen />);

    expect(
      screen.getByRole('heading', { name: /Hospital Management Information System/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('Smarter workflows. Better decisions.')).toBeInTheDocument();
    expect(screen.getByText('Healthier communities.')).toBeInTheDocument();

    for (const [title, subtitle] of [
      ['Patient Care', 'OPD · Inpatient · MCH'],
      ['Laboratory', 'Orders · Results · Reports'],
      ['Pharmacy', 'Dispensing · Inventory'],
      ['Billing & Insurance', 'Tariffs · Invoices · Claims'],
      ['Reports & Analytics', 'Real-time insights'],
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
      expect(screen.getByText(subtitle)).toBeInTheDocument();
    }

    expect(screen.getByText('Better Systems.')).toBeInTheDocument();
    expect(screen.getByText('Healthier Communities.')).toBeInTheDocument();
    expect(screen.getByText('Secure')).toBeInTheDocument();
    expect(screen.getByText('Compliant')).toBeInTheDocument();
    expect(screen.getByText('Reliable')).toBeInTheDocument();
    expect(screen.getByText("Built for Kenya's Healthcare Facilities")).toBeInTheDocument();

    expect(screen.getByRole('heading', { name: 'Welcome Back' })).toBeInTheDocument();
    expect(screen.getByText('Sign in to access your JaliCare HMIS account')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Username or Email')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sign In/i })).toBeInTheDocument();
    expect(screen.getByText('Or continue with')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Biometric Login/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Smart Card Login/i })).toBeInTheDocument();
    expect(screen.getByText('Your data is protected and secure')).toBeInTheDocument();
    expect(screen.getByText('JaliCare HMIS v1.0')).toBeInTheDocument();
  });

  it('validates required fields before calling the authentication service', () => {
    render(<LoginScreen />);

    fireEvent.click(screen.getByRole('button', { name: /Sign In/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Please enter your username or email address.',
    );
    expect(loginMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('Username or Email'), {
      target: { value: 'clinician.nyeri' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Sign In/i }));
    expect(screen.getByRole('alert')).toHaveTextContent('Please enter your password.');
    expect(loginMock).not.toHaveBeenCalled();
  });

  it('submits trimmed credentials and surfaces authentication errors clearly', async () => {
    loginMock.mockResolvedValueOnce({
      success: false,
      message: 'Invalid username/email or password.',
    });

    render(<LoginScreen />);

    fireEvent.change(screen.getByPlaceholderText('Username or Email'), {
      target: { value: '  jane.wanjiku@jalicare.ke  ' },
    });
    fireEvent.change(screen.getByPlaceholderText('Password'), {
      target: { value: 'WrongPass!123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Sign In/i }));

    await waitFor(() => {
      expect(loginMock).toHaveBeenCalledWith('jane.wanjiku@jalicare.ke', 'WrongPass!123');
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Invalid username/email or password.',
    );
  });

  it('toggles password visibility, persists Remember me identifier only, and supports language switching', async () => {
    loginMock.mockResolvedValueOnce({ success: true });

    render(<LoginScreen />);

    const passwordInput = screen.getByPlaceholderText('Password');
    expect(passwordInput).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(passwordInput).toHaveAttribute('type', 'text');

    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(passwordInput).toHaveAttribute('type', 'password');

    fireEvent.change(screen.getByPlaceholderText('Username or Email'), {
      target: { value: 'nurse.kamau' },
    });
    fireEvent.change(passwordInput, {
      target: { value: 'SecretClinicalPass#9' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /Remember me/i }));
    fireEvent.click(screen.getByRole('button', { name: /Sign In/i }));

    await waitFor(() => {
      expect(loginMock).toHaveBeenCalledWith('nurse.kamau', 'SecretClinicalPass#9');
    });

    expect(window.localStorage.getItem('jalicare_remembered_identifier')).toBe('nurse.kamau');
    expect(JSON.stringify(window.localStorage)).not.toContain('SecretClinicalPass#9');

    fireEvent.click(screen.getByRole('button', { name: /Language: English/i }));
    fireEvent.click(screen.getByRole('option', { name: 'Kiswahili' }));
    expect(screen.getByRole('heading', { name: 'Karibu Tena' })).toBeInTheDocument();
  });

  it('shows honest unavailable notices for unconfigured Biometric / Smart Card login and opens Forgot password help', () => {
    render(<LoginScreen />);

    fireEvent.click(screen.getByRole('button', { name: /Biometric Login/i }));
    expect(screen.getByRole('status')).toHaveTextContent('Biometric Login Not Configured');
    expect(loginMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Smart Card Login/i }));
    expect(screen.getByRole('status')).toHaveTextContent('Smart Card Login Not Configured');
    expect(loginMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Password Recovery Assistance');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
