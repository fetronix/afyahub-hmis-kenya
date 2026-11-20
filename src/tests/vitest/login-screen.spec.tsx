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

describe('LoginScreen — Syrona Medical Center HMIS sign-in', () => {
  it('renders the Syrona branding, module list, sign-in controls, and trust footer', () => {
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
    expect(screen.getByText('Privacy-aware')).toBeInTheDocument();
    expect(screen.queryByText('Compliant')).not.toBeInTheDocument();
    expect(screen.getByText('Reliable')).toBeInTheDocument();
    expect(screen.getByText("Built for Kenya's Healthcare Facilities")).toBeInTheDocument();

    expect(screen.getByRole('heading', { name: 'Welcome Back' })).toBeInTheDocument();
    expect(
      screen.getByText('Sign in to access your Syrona Medical Center HMIS account'),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText('fidelidemo34')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sign In/i })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Remember me/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Forgot password?' })).toBeInTheDocument();
    expect(screen.getByText('Your data is protected and secure')).toBeInTheDocument();
    expect(screen.getByText('Syrona Medical Center HMIS v1.0')).toBeInTheDocument();
  });

  it('does not offer Biometric or Smart Card sign-in and carries no legacy JaliCare or AfyaHub reference', () => {
    const { container } = render(<LoginScreen />);

    expect(screen.queryByRole('button', { name: /Biometric Login/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Smart Card Login/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/JaliCare/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/AfyaHub/i)).not.toBeInTheDocument();
    // The retired brand must not survive the rename.
    expect(container.innerHTML).not.toMatch(/jalicare|afyahub/i);
  });

  it('validates required fields before calling the authentication service', () => {
    render(<LoginScreen />);

    fireEvent.click(screen.getByRole('button', { name: /Sign In/i }));
    expect(screen.getByRole('alert')).toHaveTextContent('Please enter your username or staff ID.');
    expect(loginMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('fidelidemo34'), {
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

    fireEvent.change(screen.getByPlaceholderText('fidelidemo34'), {
      target: { value: '  jane.wanjiku@syrona.ke  ' },
    });
    fireEvent.change(screen.getByPlaceholderText('Password'), {
      target: { value: 'WrongPass!123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Sign In/i }));

    await waitFor(() => {
      expect(loginMock).toHaveBeenCalledWith('jane.wanjiku@syrona.ke', 'WrongPass!123');
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Invalid username/email or password.',
    );
  });

  it('toggles password visibility, persists the remembered identifier only, and switches language', async () => {
    loginMock.mockResolvedValueOnce({ success: true });

    render(<LoginScreen />);

    const passwordInput = screen.getByPlaceholderText('Password');
    expect(passwordInput).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(passwordInput).toHaveAttribute('type', 'text');

    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(passwordInput).toHaveAttribute('type', 'password');

    fireEvent.change(screen.getByPlaceholderText('fidelidemo34'), {
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

    expect(window.localStorage.getItem('syrona_remembered_identifier')).toBe('nurse.kamau');
    expect(JSON.stringify(window.localStorage)).not.toContain('SecretClinicalPass#9');

    fireEvent.click(screen.getByRole('button', { name: /Language: English/i }));
    fireEvent.click(screen.getByRole('option', { name: 'Kiswahili' }));
    expect(screen.getByRole('heading', { name: 'Karibu Tena' })).toBeInTheDocument();
  });

  it('opens the password recovery dialog and closes it with Escape', () => {
    render(<LoginScreen />);

    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Password Recovery Assistance');
    expect(screen.getByRole('dialog')).toHaveTextContent('Syrona Medical Center HMIS');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(loginMock).not.toHaveBeenCalled();
  });
});
