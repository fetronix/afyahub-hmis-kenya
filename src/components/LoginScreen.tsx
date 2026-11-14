import React, { useEffect, useId, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  Info,
  Loader2,
  X,
} from 'lucide-react';

import { useHmis } from '../context/HmisContext.tsx';

/*
|--------------------------------------------------------------------------
| Official JaliCare Assets & Storage Keys
|--------------------------------------------------------------------------
|
| `public/logo.png` (676x369 RGBA) is the official transparent JaliCare
| wordmark + shield asset. Its visible artwork occupies x=138..538 (400px)
| and y=119..250 (131px), with fully transparent margins outside that box.
| Wrapping it in an exact 400:131 aspect box displays the original asset
| without distortion, redrawing, or altering the source file.
|
*/

const LOGO_SRC = '/logo.png';
const CLINICIAN_IMAGE_SRC = '/clinician-login.jpg';

const REMEMBER_ME_KEY = 'jalicare_remember_me';
const REMEMBERED_IDENTIFIER_KEY = 'jalicare_remembered_identifier';
const LANGUAGE_STORAGE_KEY = 'jalicare_login_lang';

type LanguageCode = 'en' | 'sw';

interface LoginCopy {
  languageLabel: string;
  heroHeadingLine1: string;
  heroHeadingLine2: string;
  heroSubLine1: string;
  heroSubLine2: string;
  services: Array<{
    id: string;
    title: string;
    subtitle: string;
    tone: 'blue-sky' | 'orange-bright' | 'blue-royal' | 'orange-warm' | 'blue-deep';
  }>;
  footerScriptLine1: string;
  footerScriptLine2: string;
  securityPillar1: string;
  securityPillar2: string;
  securityPillar3: string;
  securitySubtitle: string;
  welcomeHeading: string;
  welcomeSubheading: string;
  usernameLabel: string;
  usernamePlaceholder: string;
  passwordLabel: string;
  passwordPlaceholder: string;
  rememberMe: string;
  forgotPassword: string;
  signIn: string;
  signingIn: string;
  orContinueWith: string;
  biometricLogin: string;
  smartCardLogin: string;
  protectedData: string;
  versionLabel: string;
  missingIdentifierError: string;
  missingPasswordError: string;
  genericSignInError: string;
  mfaRequiredMessage: string;
  passwordChangeRequiredMessage: string;
  biometricUnavailableTitle: string;
  biometricUnavailableMessage: string;
  smartCardUnavailableTitle: string;
  smartCardUnavailableMessage: string;
  forgotModalTitle: string;
  forgotModalSubtitle: string;
  forgotModalBody1: string;
  forgotModalBody2: string;
  forgotModalAccountHint: string;
  forgotModalClose: string;
}

const COPY: Record<LanguageCode, LoginCopy> = {
  en: {
    languageLabel: 'English',
    heroHeadingLine1: 'Hospital Management',
    heroHeadingLine2: 'Information System',
    heroSubLine1: 'Smarter workflows. Better decisions.',
    heroSubLine2: 'Healthier communities.',
    services: [
      {
        id: 'patient-care',
        title: 'Patient Care',
        subtitle: 'OPD · Inpatient · MCH',
        tone: 'blue-sky',
      },
      {
        id: 'laboratory',
        title: 'Laboratory',
        subtitle: 'Orders · Results · Reports',
        tone: 'orange-bright',
      },
      {
        id: 'pharmacy',
        title: 'Pharmacy',
        subtitle: 'Dispensing · Inventory',
        tone: 'blue-royal',
      },
      {
        id: 'billing',
        title: 'Billing & Insurance',
        subtitle: 'Tariffs · Invoices · Claims',
        tone: 'orange-warm',
      },
      {
        id: 'reports',
        title: 'Reports & Analytics',
        subtitle: 'Real-time insights',
        tone: 'blue-deep',
      },
    ],
    footerScriptLine1: 'Better Systems.',
    footerScriptLine2: 'Healthier Communities.',
    securityPillar1: 'Secure',
    securityPillar2: 'Privacy-aware',
    securityPillar3: 'Reliable',
    securitySubtitle: "Built for Kenya's Healthcare Facilities",
    welcomeHeading: 'Welcome Back',
    welcomeSubheading: 'Sign in to access your JaliCare HMIS account',
    usernameLabel: 'Username or Email',
    usernamePlaceholder: 'Username or Email',
    passwordLabel: 'Password',
    passwordPlaceholder: 'Password',
    rememberMe: 'Remember me',
    forgotPassword: 'Forgot password?',
    signIn: 'Sign In',
    signingIn: 'Signing In...',
    orContinueWith: 'Or continue with',
    biometricLogin: 'Biometric Login',
    smartCardLogin: 'Smart Card Login',
    protectedData: 'Your data is protected and secure',
    versionLabel: 'JaliCare HMIS v1.0',
    missingIdentifierError: 'Please enter your username or email address.',
    missingPasswordError: 'Please enter your password.',
    genericSignInError: 'Unable to sign in. Please verify your credentials and try again.',
    mfaRequiredMessage:
      'Additional security verification is required for your account before completing sign-in.',
    passwordChangeRequiredMessage:
      'Your account requires an administrator-verified password update before continuing.',
    biometricUnavailableTitle: 'Biometric Login Not Configured',
    biometricUnavailableMessage:
      'Biometric authentication requires an enrolled FIDO2/fingerprint reader and facility biometric service configuration. Please sign in with your Username or Email and Password.',
    smartCardUnavailableTitle: 'Smart Card Login Not Configured',
    smartCardUnavailableMessage:
      'Smart Card sign-in requires a connected health practitioner smart-card reader and facility PKI middleware. Please sign in with your Username or Email and Password.',
    forgotModalTitle: 'Password Recovery Assistance',
    forgotModalSubtitle:
      'For clinical data protection, JaliCare HMIS credentials are managed by your facility.',
    forgotModalBody1:
      'Self-service email password reset is disabled to protect patient records and enforce facility audit controls.',
    forgotModalBody2:
      'Contact your Facility System Administrator or ICT Helpdesk to issue a verified password reset or new staff invitation link.',
    forgotModalAccountHint: 'Account reference to share with your administrator:',
    forgotModalClose: 'Back to Sign In',
  },
  sw: {
    languageLabel: 'Kiswahili',
    heroHeadingLine1: 'Mfumo wa Usimamizi',
    heroHeadingLine2: 'wa Taarifa za Hospitali',
    heroSubLine1: 'Mtiririko bora wa kazi. Maamuzi sahihi.',
    heroSubLine2: 'Jamii zenye afya bora.',
    services: [
      {
        id: 'patient-care',
        title: 'Huduma kwa Wagonjwa',
        subtitle: 'OPD · Kulazwa · MCH',
        tone: 'blue-sky',
      },
      {
        id: 'laboratory',
        title: 'Maabara',
        subtitle: 'Vipimo · Majibu · Ripoti',
        tone: 'orange-bright',
      },
      {
        id: 'pharmacy',
        title: 'Famasia',
        subtitle: 'Utoaji Dawa · Hifadhi',
        tone: 'blue-royal',
      },
      {
        id: 'billing',
        title: 'Malipo na Bima',
        subtitle: 'Bei · Ankara · Madai',
        tone: 'orange-warm',
      },
      {
        id: 'reports',
        title: 'Ripoti na Takwimu',
        subtitle: 'Uchambuzi wa papo hapo',
        tone: 'blue-deep',
      },
    ],
    footerScriptLine1: 'Mifumo Bora.',
    footerScriptLine2: 'Jamii Zenye Afya.',
    securityPillar1: 'Salama',
    securityPillar2: 'Faragha',
    securityPillar3: 'Imara',
    securitySubtitle: 'Imeundwa kwa Vituo vya Afya vya Kenya',
    welcomeHeading: 'Karibu Tena',
    welcomeSubheading: 'Ingia ili kufungua akaunti yako ya JaliCare HMIS',
    usernameLabel: 'Jina la Mtumiaji au Barua Pepe',
    usernamePlaceholder: 'Jina la Mtumiaji au Barua Pepe',
    passwordLabel: 'Nenosiri',
    passwordPlaceholder: 'Nenosiri',
    rememberMe: 'Nikumbuke',
    forgotPassword: 'Umesahau nenosiri?',
    signIn: 'Ingia',
    signingIn: 'Inaingia...',
    orContinueWith: 'Au endelea na',
    biometricLogin: 'Ingia kwa Alama ya Kidole',
    smartCardLogin: 'Ingia kwa Kadi Maalum',
    protectedData: 'Taarifa zako zinalindwa na ziko salama',
    versionLabel: 'JaliCare HMIS v1.0',
    missingIdentifierError: 'Tafadhali weka jina la mtumiaji au anwani ya barua pepe.',
    missingPasswordError: 'Tafadhali weka nenosiri lako.',
    genericSignInError:
      'Imeshindikana kuingia. Hakikisha taarifa zako ni sahihi kisha ujaribu tena.',
    mfaRequiredMessage: 'Uthibitisho wa ziada wa usalama unahitajika kabla ya kukamilisha kuingia.',
    passwordChangeRequiredMessage:
      'Akaunti yako inahitaji kubadilisha nenosiri kabla ya kuendelea.',
    biometricUnavailableTitle: 'Alama ya Kidole Haijaunganishwa',
    biometricUnavailableMessage:
      'Uthibitisho wa alama ya kidole unahitaji kifaa kilichosajiliwa kwenye kituo chako. Tafadhali ingia kwa jina la mtumiaji na nenosiri.',
    smartCardUnavailableTitle: 'Kadi Maalum Haijaunganishwa',
    smartCardUnavailableMessage:
      'Kuingia kwa kadi maalum kunahitaji kisoma-kadi cha kituo. Tafadhali ingia kwa jina la mtumiaji na nenosiri.',
    forgotModalTitle: 'Msaada wa kurejesha Nenosiri',
    forgotModalSubtitle:
      'Kwa usalama wa taarifa za wagonjwa, nywila za JaliCare HMIS husimamiwa na kituo chako.',
    forgotModalBody1:
      'Kubadilisha nenosiri bila msimamizi kumezimwa ili kulinda kumbukumbu za matibabu.',
    forgotModalBody2:
      'Wasiliana na Msimamizi wa Mfumo wa Kituo chako au kitengo cha ICT ili kuwekewa nenosiri jipya.',
    forgotModalAccountHint: 'Jina la akaunti la kumpatia msimamizi wako:',
    forgotModalClose: 'Rudi Kuingia',
  },
};

function readInitialRememberMe(): boolean {
  try {
    return window.localStorage.getItem(REMEMBER_ME_KEY) === 'true';
  } catch {
    return false;
  }
}

function readInitialIdentifier(): string {
  try {
    if (window.localStorage.getItem(REMEMBER_ME_KEY) === 'true') {
      return window.localStorage.getItem(REMEMBERED_IDENTIFIER_KEY) ?? '';
    }
    return '';
  } catch {
    return '';
  }
}

function readInitialLanguage(): LanguageCode {
  try {
    const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return saved === 'sw' ? 'sw' : 'en';
  } catch {
    return 'en';
  }
}

/*
|--------------------------------------------------------------------------
| Official Logo Wrapper
|--------------------------------------------------------------------------
*/

interface JaliCareLogoProps {
  className?: string;
}

const JaliCareLogo: React.FC<JaliCareLogoProps> = ({ className = 'w-[320px]' }) => {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="inline-flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#0755A4] text-lg font-extrabold text-white shadow-sm">
          +
        </span>
        <div className="leading-none">
          <div className="text-2xl font-extrabold tracking-tight text-[#0B4F8A]">
            JALI <span className="text-[#EB711D]">CARE</span>
          </div>
          <div className="mt-1 text-xs font-medium text-[#3D4E63]">Healthcare. Empowered.</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative select-none overflow-visible aspect-[400/131] ${className}`}>
      <img
        src={LOGO_SRC}
        alt="JaliCare — Healthcare. Empowered."
        draggable={false}
        onError={() => setFailed(true)}
        className="pointer-events-none absolute block h-auto max-w-none"
        style={{
          width: '169%',
          left: '-34.5%',
          top: '-90.84%',
        }}
      />
    </div>
  );
};

/*
|--------------------------------------------------------------------------
| Bespoke Reference Icons (matching the exact iconography of the design)
|--------------------------------------------------------------------------
*/

const ServiceIcon: React.FC<{ id: string }> = ({ id }) => {
  switch (id) {
    case 'patient-care':
      return (
        <svg viewBox="0 0 28 28" className="h-[28px] w-[28px]" fill="none" aria-hidden="true">
          <circle cx="12.5" cy="8.5" r="4.1" fill="#FFFFFF" />
          <path
            d="M5.2 20.6c0-3.55 3.22-6.1 7.3-6.1 1.65 0 3.17.4 4.38 1.12a5.35 5.35 0 0 0-2.38 4.46c0 .58.09 1.14.26 1.66H6.4c-.66 0-1.2-.5-1.2-1.14Z"
            fill="#FFFFFF"
          />
          <circle cx="19.8" cy="19.6" r="4.2" fill="#FFFFFF" />
          <path
            d="M19.8 17.4v4.4M17.6 19.6h4.4"
            stroke="#0A87EC"
            strokeWidth="1.9"
            strokeLinecap="round"
          />
        </svg>
      );

    case 'laboratory':
      return (
        <svg viewBox="0 0 28 28" className="h-[28px] w-[28px]" fill="none" aria-hidden="true">
          <path
            d="M10.2 5.2h7.6M11.8 5.2v5.1l-5.3 9.45A2.15 2.15 0 0 0 8.38 23h11.24a2.15 2.15 0 0 0 1.88-3.25l-5.3-9.45V5.2"
            stroke="#FFFFFF"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M8.5 17.5h11" stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="12.6" cy="20.1" r="1.05" fill="#FFFFFF" />
          <circle cx="15.8" cy="19.4" r="0.85" fill="#FFFFFF" />
        </svg>
      );

    case 'pharmacy':
      return (
        <svg viewBox="0 0 28 28" className="h-[27px] w-[27px]" fill="none" aria-hidden="true">
          <g transform="rotate(-45 14 14)">
            <rect
              x="8.6"
              y="4.8"
              width="10.8"
              height="18.4"
              rx="5.4"
              stroke="#FFFFFF"
              strokeWidth="2"
            />
            <path d="M8.6 10.2a5.4 5.4 0 0 1 10.8 0V14H8.6v-3.8Z" fill="#FFFFFF" />
            <line
              x1="12.2"
              y1="16.8"
              x2="12.2"
              y2="19.3"
              stroke="#FFFFFF"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
          </g>
        </svg>
      );

    case 'billing':
      return (
        <svg viewBox="0 0 28 28" className="h-[28px] w-[28px]" fill="none" aria-hidden="true">
          <path
            d="M16.8 9.2V6.9c0-1.16-.94-2.1-2.1-2.1H7.9c-1.16 0-2.1.94-2.1 2.1v14.2c0 1.16.94 2.1 2.1 2.1h6.8c1.16 0 2.1-.94 2.1-2.1v-2.1"
            stroke="#FFFFFF"
            strokeWidth="1.9"
            strokeLinecap="round"
          />
          <line
            x1="10"
            y1="7.5"
            x2="12.6"
            y2="7.5"
            stroke="#FFFFFF"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <rect
            x="13.2"
            y="10.2"
            width="9.4"
            height="8.6"
            rx="2.3"
            fill="#FF941B"
            stroke="#FFFFFF"
            strokeWidth="1.85"
          />
          <path
            d="M17.9 12.1v4.8M19.1 13.05c-.25-.38-.68-.58-1.22-.58-.74 0-1.26.37-1.26.92 0 .54.46.76 1.28.96.82.2 1.28.45 1.28 1.02 0 .58-.54.96-1.34.96-.58 0-1.04-.22-1.32-.64"
            stroke="#FFFFFF"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      );

    default:
      return (
        <svg viewBox="0 0 28 28" className="h-[28px] w-[28px]" fill="none" aria-hidden="true">
          <path
            d="M14 4.4 6.2 7.5v6.2c0 5.08 3.33 9.52 7.8 10.95 4.47-1.43 7.8-5.87 7.8-10.95V7.5L14 4.4Z"
            fill="#FFFFFF"
          />
          <path
            d="m10.6 14.2 2.35 2.4 4.65-4.8"
            stroke="#2466FA"
            strokeWidth="2.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
  }
};

const ShieldLockIcon: React.FC = () => (
  <svg viewBox="0 0 48 54" className="h-[52px] w-[46px] shrink-0" fill="none" aria-hidden="true">
    <path
      d="M24 3.5 6.5 10.2v14.2c0 11.7 7.45 22.1 17.5 25.8 10.05-3.7 17.5-14.1 17.5-25.8V10.2L24 3.5Z"
      stroke="#FFFFFF"
      strokeWidth="2.4"
      strokeLinejoin="round"
    />
    <path
      d="M19 23.2v-3.1a5 5 0 0 1 10 0v3.1"
      stroke="#FFFFFF"
      strokeWidth="2.3"
      strokeLinecap="round"
    />
    <rect x="16.2" y="23.2" width="15.6" height="12.2" rx="2.5" fill="#FFFFFF" />
    <circle cx="24" cy="28.1" r="1.55" fill="#135EAC" />
    <path d="M24 29.4v2.8" stroke="#135EAC" strokeWidth="1.9" strokeLinecap="round" />
  </svg>
);

const GlobeOutlineIcon: React.FC = () => (
  <svg viewBox="0 0 20 20" className="h-[18px] w-[18px] shrink-0" fill="none" aria-hidden="true">
    <circle cx="10" cy="10" r="7.6" stroke="#0C56A8" strokeWidth="1.5" />
    <ellipse cx="10" cy="10" rx="3.5" ry="7.6" stroke="#0C56A8" strokeWidth="1.35" />
    <path d="M2.8 7.5h14.4M2.8 12.5h14.4" stroke="#0C56A8" strokeWidth="1.3" />
  </svg>
);

const UserOutlineIcon: React.FC = () => (
  <svg viewBox="0 0 22 22" className="h-[20px] w-[20px]" fill="none" aria-hidden="true">
    <circle cx="11" cy="7.4" r="3.4" stroke="#285499" strokeWidth="1.75" />
    <path
      d="M4.8 18.2c.55-3.1 3.1-5.1 6.2-5.1s5.65 2 6.2 5.1"
      stroke="#285499"
      strokeWidth="1.75"
      strokeLinecap="round"
    />
  </svg>
);

const LockOutlineIcon: React.FC = () => (
  <svg viewBox="0 0 22 22" className="h-[20px] w-[20px]" fill="none" aria-hidden="true">
    <path
      d="M7.3 9.6V7.2a3.7 3.7 0 0 1 7.4 0v2.4"
      stroke="#285499"
      strokeWidth="1.75"
      strokeLinecap="round"
    />
    <rect x="5.1" y="9.6" width="11.8" height="9" rx="2.3" stroke="#285499" strokeWidth="1.75" />
    <circle cx="11" cy="14.1" r="1.2" fill="#285499" />
  </svg>
);

const BiometricFingerprintIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] shrink-0" fill="none" aria-hidden="true">
    <path
      d="M7.2 6.1A7.4 7.4 0 0 1 12 4.4c2.05 0 3.9.82 5.24 2.15"
      stroke="#0958D8"
      strokeWidth="1.75"
      strokeLinecap="round"
    />
    <path
      d="M5.2 10.6a7.1 7.1 0 0 1 13.6 0c.22.9.25 1.95.08 3.15"
      stroke="#0958D8"
      strokeWidth="1.75"
      strokeLinecap="round"
    />
    <path
      d="M7.8 11.4a4.35 4.35 0 0 1 8.45.4c.18 1.55-.08 3.4-.78 5.2"
      stroke="#0958D8"
      strokeWidth="1.75"
      strokeLinecap="round"
    />
    <path
      d="M10.5 11.8a1.65 1.65 0 0 1 3.15.55c.1 1.75-.32 3.85-1.35 5.95"
      stroke="#0958D8"
      strokeWidth="1.75"
      strokeLinecap="round"
    />
    <path
      d="M7.6 14.3c-.12 1.45-.58 2.85-1.35 4.1M9.9 15.8c-.28 1.45-.82 2.78-1.6 3.9"
      stroke="#0958D8"
      strokeWidth="1.75"
      strokeLinecap="round"
    />
  </svg>
);

const SmartCardChipIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" className="h-[21px] w-[21px] shrink-0" fill="none" aria-hidden="true">
    <rect x="3.2" y="5.2" width="17.6" height="13.6" rx="2.6" stroke="#0B4DA8" strokeWidth="1.85" />
    <line x1="3.6" y1="9.3" x2="20.4" y2="9.3" stroke="#0B4DA8" strokeWidth="1.75" />
    <rect x="6.4" y="12.2" width="3.8" height="3.2" rx="0.8" fill="#0B4DA8" />
    <line
      x1="12.6"
      y1="14.5"
      x2="17.4"
      y2="14.5"
      stroke="#0B4DA8"
      strokeWidth="1.75"
      strokeLinecap="round"
    />
  </svg>
);

const ProtectedShieldCheckIcon: React.FC = () => (
  <svg viewBox="0 0 20 22" className="h-[19px] w-[17px] shrink-0" fill="none" aria-hidden="true">
    <path
      d="M10 1.4 2.4 4.4v5.8c0 5.05 3.24 9.54 7.6 10.95 4.36-1.41 7.6-5.9 7.6-10.95V4.4L10 1.4Z"
      fill="#0A58CA"
    />
    <path
      d="m6.9 11.1 2.15 2.15 4.25-4.35"
      stroke="#FFFFFF"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const SERVICE_BADGE_STYLES: Record<LoginCopy['services'][number]['tone'], string> = {
  'blue-sky':
    'bg-gradient-to-b from-[#23A3FC] to-[#0583E8] shadow-[0_6px_14px_-4px_rgba(7,135,236,0.45)]',
  'orange-bright':
    'bg-gradient-to-b from-[#FF9B26] to-[#FD7301] shadow-[0_6px_14px_-4px_rgba(253,118,4,0.42)]',
  'blue-royal':
    'bg-gradient-to-b from-[#1B8BFF] to-[#116AFB] shadow-[0_6px_14px_-4px_rgba(18,109,251,0.44)]',
  'orange-warm':
    'bg-gradient-to-b from-[#FFA424] to-[#FD8510] shadow-[0_6px_14px_-4px_rgba(253,136,18,0.42)]',
  'blue-deep':
    'bg-gradient-to-b from-[#367DFD] to-[#2060F8] shadow-[0_6px_14px_-4px_rgba(34,99,249,0.44)]',
};

/*
|--------------------------------------------------------------------------
| Login Screen Component
|--------------------------------------------------------------------------
*/

export const LoginScreen: React.FC = () => {
  const { login } = useHmis();

  const [language, setLanguage] = useState<LanguageCode>(readInitialLanguage);
  const [langMenuOpen, setLangMenuOpen] = useState(false);

  const [identifier, setIdentifier] = useState<string>(readInitialIdentifier);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState<boolean>(readInitialRememberMe);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [altAuthNotice, setAltAuthNotice] = useState<{
    title: string;
    message: string;
  } | null>(null);
  const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false);
  const [clinicianImgFailed, setClinicianImgFailed] = useState(false);

  const langDropdownRef = useRef<HTMLDivElement | null>(null);
  const forgotModalTitleId = useId();

  const copy = COPY[language];

  /*
   * Close language menu and forgot-password dialog on Escape or outside click.
   */
  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (
        langDropdownRef.current &&
        event.target instanceof Node &&
        !langDropdownRef.current.contains(event.target)
      ) {
        setLangMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setLangMenuOpen(false);
        setForgotPasswordOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleLanguageSelect = (next: LanguageCode) => {
    setLanguage(next);
    setLangMenuOpen(false);
    setError('');
    setAltAuthNotice(null);
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    } catch {
      /* Ignore storage quota/privacy restrictions. */
    }
  };

  const handleRememberMeChange = (checked: boolean) => {
    setRememberMe(checked);
    try {
      if (checked) {
        window.localStorage.setItem(REMEMBER_ME_KEY, 'true');
        if (identifier.trim()) {
          window.localStorage.setItem(REMEMBERED_IDENTIFIER_KEY, identifier.trim());
        }
      } else {
        window.localStorage.removeItem(REMEMBER_ME_KEY);
        window.localStorage.removeItem(REMEMBERED_IDENTIFIER_KEY);
      }
    } catch {
      /* Ignore storage restrictions. */
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (loading) {
      return;
    }

    setError('');
    setInfoMessage('');
    setAltAuthNotice(null);

    const cleanIdentifier = identifier.trim();

    if (!cleanIdentifier) {
      setError(copy.missingIdentifierError);
      return;
    }

    if (!password) {
      setError(copy.missingPasswordError);
      return;
    }

    try {
      if (rememberMe) {
        window.localStorage.setItem(REMEMBER_ME_KEY, 'true');
        window.localStorage.setItem(REMEMBERED_IDENTIFIER_KEY, cleanIdentifier);
      } else {
        window.localStorage.removeItem(REMEMBER_ME_KEY);
        window.localStorage.removeItem(REMEMBERED_IDENTIFIER_KEY);
      }
    } catch {
      /* Ignore storage restrictions. */
    }

    setLoading(true);

    try {
      const result = await login(cleanIdentifier, password);

      if (!result.success) {
        setError(result.message || copy.genericSignInError);
        return;
      }

      if (result.requiresMfa) {
        setInfoMessage(result.message || copy.mfaRequiredMessage);
        return;
      }

      if (result.requiresPasswordChange) {
        setInfoMessage(copy.passwordChangeRequiredMessage);
        return;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : copy.genericSignInError;
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleAlternativeLogin = (method: 'biometric' | 'smartcard') => {
    setError('');
    setInfoMessage('');
    if (method === 'biometric') {
      setAltAuthNotice({
        title: copy.biometricUnavailableTitle,
        message: copy.biometricUnavailableMessage,
      });
    } else {
      setAltAuthNotice({
        title: copy.smartCardUnavailableTitle,
        message: copy.smartCardUnavailableMessage,
      });
    }
  };

  return (
    <main className="jalicare-login-page relative flex min-h-screen w-full items-center justify-center overflow-x-hidden px-4 py-6 sm:px-8 md:px-10 md:py-9 lg:px-14 xl:px-[83px] xl:py-[85px]">
      {/* -----------------------------------------------------------------
          Ambient Background Curves & Decorative Corner Ribbons
      ----------------------------------------------------------------- */}
      <svg
        aria-hidden="true"
        viewBox="0 0 800 640"
        preserveAspectRatio="none"
        className="pointer-events-none absolute left-0 top-0 h-[58vh] w-[48vw] max-w-[740px]"
      >
        <path d="M0 0H735C662 175 492 405 0 612V0Z" fill="url(#jaliBgTopLeftWash)" />
        <defs>
          <linearGradient id="jaliBgTopLeftWash" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#F7FBFF" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#E7F2FC" stopOpacity="0.35" />
          </linearGradient>
        </defs>
      </svg>

      {/* Top-right sweeping blue & orange ribbon */}
      <svg
        aria-hidden="true"
        viewBox="0 0 210 112"
        fill="none"
        className="pointer-events-none absolute right-0 top-0 h-[78px] w-[146px] sm:h-[98px] sm:w-[184px] xl:h-[106px] xl:w-[198px]"
      >
        <path d="M114 0H210V62C166 52 134 29 114 0Z" fill="url(#jaliCornerTopBlue)" />
        <path
          d="M42 0H116C136 30 168 53 210 62V104C132 88 74 52 42 0Z"
          fill="url(#jaliCornerTopOrange)"
        />
        <defs>
          <linearGradient
            id="jaliCornerTopBlue"
            x1="118"
            y1="0"
            x2="210"
            y2="58"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#076ED5" />
            <stop offset="55%" stopColor="#015BB3" />
            <stop offset="100%" stopColor="#014798" />
          </linearGradient>
          <linearGradient
            id="jaliCornerTopOrange"
            x1="46"
            y1="0"
            x2="208"
            y2="96"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#FDB05E" />
            <stop offset="48%" stopColor="#FE8C2C" />
            <stop offset="100%" stopColor="#FE7011" />
          </linearGradient>
        </defs>
      </svg>

      {/* Bottom-right soft warm orange curve */}
      <svg
        aria-hidden="true"
        viewBox="0 0 260 160"
        fill="none"
        className="pointer-events-none absolute bottom-0 right-0 h-[105px] w-[170px] sm:h-[140px] sm:w-[228px] xl:h-[154px] xl:w-[250px]"
      >
        <path d="M260 14C224 68 152 124 22 160H260V14Z" fill="url(#jaliCornerBottomOrange)" />
        <defs>
          <linearGradient
            id="jaliCornerBottomOrange"
            x1="34"
            y1="160"
            x2="255"
            y2="28"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#FEA558" />
            <stop offset="52%" stopColor="#FECF96" />
            <stop offset="100%" stopColor="#FFE1BA" />
          </linearGradient>
        </defs>
      </svg>

      {/* -----------------------------------------------------------------
          Main Centered Split-Screen Application Container
      ----------------------------------------------------------------- */}
      <div className="jalicare-shell-shadow relative z-10 flex w-full max-w-[1378px] flex-col md:flex-row md:items-stretch">
        {/* ===============================================================
            LEFT BRANDING & INFORMATION PANEL (~56.5% width on desktop)
        =============================================================== */}
        <section
          aria-label="JaliCare HMIS Overview"
          className="jalicare-left-panel relative order-2 mt-5 flex w-full flex-col justify-between overflow-hidden rounded-[24px] md:order-1 md:mt-0 md:w-[56%] md:rounded-l-[24px] md:rounded-r-none lg:w-[56.82%] xl:h-[843px]"
        >
          {/* Right-side Clinician Photograph + Seamless Feather Blend */}
          {!clinicianImgFailed && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 hidden overflow-hidden sm:block"
            >
              <img
                src={CLINICIAN_IMAGE_SRC}
                alt=""
                onError={() => setClinicianImgFailed(true)}
                className="absolute bottom-[132px] right-0 h-auto w-[68%] max-w-none select-none xl:bottom-auto xl:top-[-3.8%] xl:w-[66.8%]"
                style={{
                  maskImage:
                    'linear-gradient(to right, transparent 0%, rgba(0,0,0,0.36) 12%, rgba(0,0,0,0.88) 26%, black 40%), linear-gradient(to bottom, transparent 0%, black 11%, black 100%)',
                  maskComposite: 'intersect',
                  WebkitMaskImage:
                    'linear-gradient(to right, transparent 0%, rgba(0,0,0,0.36) 12%, rgba(0,0,0,0.88) 26%, black 40%), linear-gradient(to bottom, transparent 0%, black 11%, black 100%)',
                  WebkitMaskComposite: 'source-in',
                }}
              />
              {/* Subtle top airy highlight behind the wordmark */}
              <div
                className="absolute inset-x-0 top-0 h-[30%]"
                style={{
                  background:
                    'linear-gradient(180deg, rgba(250,253,255,0.82) 0%, rgba(248,252,255,0.38) 56%, rgba(248,252,255,0) 100%)',
                }}
              />
            </div>
          )}

          {/* Upper Branding, Heading & Five Compact Service Rows */}
          <div className="relative z-10 px-6 pt-6 sm:px-9 sm:pt-7 md:px-8 md:pt-6 lg:px-11 lg:pt-6 xl:px-[56px] xl:pt-[20px]">
            {/* Desktop/Tablet top JaliCare logo */}
            <div className="hidden md:block">
              <JaliCareLogo className="w-[265px] lg:w-[345px] xl:w-[412px]" />
            </div>

            <h1 className="mt-2 text-[1.55rem] font-bold leading-[1.18] tracking-[-0.02em] text-[#074794] sm:text-[1.7rem] md:mt-5 md:text-[1.5rem] lg:mt-6 lg:text-[1.78rem] xl:mt-[34px] xl:text-[31px]">
              <span className="block">{copy.heroHeadingLine1}</span>{' '}
              <span className="block">{copy.heroHeadingLine2}</span>
            </h1>

            <p className="mt-2.5 text-[14px] font-normal leading-[1.48] text-[#2A4B7C] lg:text-[15px] xl:mt-[12px] xl:text-[15.5px]">
              <span className="block">{copy.heroSubLine1}</span>{' '}
              <span className="block">{copy.heroSubLine2}</span>
            </p>

            {/* Five Service Rows */}
            <ul className="mt-6 space-y-3 sm:grid sm:grid-cols-2 sm:gap-3 sm:space-y-0 md:mt-5 md:block md:space-y-2.5 lg:mt-6 lg:space-y-3.5 xl:mt-[27px] xl:space-y-[15px]">
              {copy.services.map((service) => (
                <li key={service.id} className="flex items-center gap-3.5 xl:gap-[15px]">
                  <span
                    className={`flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[12px] xl:h-[46px] xl:w-[46px] xl:rounded-[13px] ${SERVICE_BADGE_STYLES[service.tone]}`}
                  >
                    <ServiceIcon id={service.id} />
                  </span>
                  <div className="min-w-0 leading-tight">
                    <p className="text-[13.5px] font-bold tracking-[-0.01em] text-[#073B84] xl:text-[14.5px]">
                      {service.title}
                    </p>
                    <p className="mt-0.5 text-[12px] font-normal text-[#265A9E] xl:text-[12.5px]">
                      {service.subtitle}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Sweeping Orange-and-Blue Curved Divider + Deep-Blue Footer */}
          <div className="relative z-10 mt-5 pt-[118px] sm:pt-14 md:mt-5 md:pt-14 lg:pt-14 xl:-mt-[10px] xl:h-[212px] xl:pt-0">
            {/* Exact reference wave geometry */}
            <svg
              aria-hidden="true"
              viewBox="0 0 775 215"
              preserveAspectRatio="none"
              className="pointer-events-none absolute inset-0 h-full w-full"
            >
              {/* Deep-blue footer fill under the curve */}
              <path
                d="M0 54C92 78 216 93 348 93C468 93 608 58 775 11V215H0V54Z"
                fill="url(#jaliLeftFooterBlue)"
              />
              {/* Subtle cyan crest glow near the center-left transition */}
              <path
                d="M250 91C325 95 395 92 475 79C412 96 340 103 250 91Z"
                fill="#1D8BF1"
                fillOpacity="0.45"
              />
              {/* Sweeping orange ribbon on the left */}
              <path
                d="M0 7C92 49 218 77 355 80C418 81 474 78 528 71C468 83 408 93 344 93C214 93 92 78 0 54V7Z"
                fill="url(#jaliLeftWaveOrange)"
              />
              <defs>
                <linearGradient
                  id="jaliLeftFooterBlue"
                  x1="387"
                  y1="15"
                  x2="387"
                  y2="215"
                  gradientUnits="userSpaceOnUse"
                >
                  <stop offset="0%" stopColor="#0459B2" />
                  <stop offset="48%" stopColor="#034B9B" />
                  <stop offset="100%" stopColor="#023A82" />
                </linearGradient>
                <linearGradient
                  id="jaliLeftWaveOrange"
                  x1="0"
                  y1="38"
                  x2="528"
                  y2="84"
                  gradientUnits="userSpaceOnUse"
                >
                  <stop offset="0%" stopColor="#FF860E" />
                  <stop offset="58%" stopColor="#FE7902" />
                  <stop offset="100%" stopColor="#F29436" stopOpacity="0.92" />
                </linearGradient>
              </defs>
            </svg>

            {/* Footer Content Row */}
            <div className="relative z-10 flex flex-col gap-4 px-6 pb-6 pt-5 sm:flex-row sm:items-end sm:justify-between sm:px-9 md:px-7 md:pb-6 lg:px-10 xl:h-full xl:items-end xl:px-[36px] xl:pb-[24px] xl:pt-0">
              {/* Handwritten-style motto + curved orange underline */}
              <div className="xl:pl-[18px] xl:pb-[4px]">
                <div className="inline-block -rotate-[7.5deg] select-none">
                  <p className="jalicare-script text-[22px] font-semibold leading-[1.06] tracking-[0.01em] text-white drop-shadow-[0_1px_2px_rgba(0,25,65,0.3)] lg:text-[24px] xl:text-[26px]">
                    <span className="block">{copy.footerScriptLine1}</span>{' '}
                    <span className="block">{copy.footerScriptLine2}</span>
                  </p>
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 140 16"
                    fill="none"
                    className="ml-7 mt-0.5 h-[12px] w-[112px] xl:w-[122px]"
                  >
                    <path
                      d="M3 13C42 5 88 2.5 137 4"
                      stroke="#FF7C0A"
                      strokeWidth="3.2"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
              </div>

              {/* Translucent Blue Security Card */}
              <div className="jalicare-security-card flex items-center gap-3 rounded-[22px] px-4 py-3.5 text-white md:gap-2.5 md:px-3 md:py-3 lg:gap-3.5 lg:px-4 lg:py-3.5 xl:h-[98px] xl:w-[384px] xl:gap-3.5 xl:rounded-[23px] xl:px-[22px]">
                <ShieldLockIcon />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-x-2 whitespace-nowrap text-[12.5px] font-normal tracking-[0.01em] text-white md:gap-x-1.5 md:text-[11.5px] lg:gap-x-2.5 lg:text-[13px] xl:gap-x-3 xl:text-[15px]">
                    <span>{copy.securityPillar1}</span>
                    <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-white/50" />
                    <span>{copy.securityPillar2}</span>
                    <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-white/50" />
                    <span>{copy.securityPillar3}</span>
                  </div>
                  <p className="mt-1.5 text-[11.5px] font-normal text-white/95 md:text-[11px] lg:text-[12px] xl:mt-[6px] xl:text-[13.2px]">
                    {copy.securitySubtitle}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ===============================================================
            RIGHT LOGIN PANEL (~43.5% width on desktop)
        =============================================================== */}
        <section
          aria-label="JaliCare HMIS Sign In"
          className="jalicare-right-card relative order-1 z-20 flex w-full flex-col justify-between rounded-[24px] px-6 pb-7 pt-5 sm:px-10 sm:pb-8 sm:pt-6 md:order-2 md:-ml-2 md:-my-[6px] md:w-[44.8%] md:px-7 lg:w-[43.76%] lg:px-10 xl:min-h-[855px] xl:justify-start xl:px-[62px] xl:pb-[42px] xl:pt-[28px]"
        >
          {/* Top-right compact language selector */}
          <div className="flex justify-end xl:-mr-[38px]">
            <div ref={langDropdownRef} className="relative">
              <button
                type="button"
                onClick={() => setLangMenuOpen((open) => !open)}
                aria-haspopup="listbox"
                aria-expanded={langMenuOpen}
                aria-label={`Language: ${copy.languageLabel}`}
                className="inline-flex h-[38px] min-w-[148px] items-center justify-between gap-2.5 rounded-full border border-[#E2EEF9] bg-white px-4 text-[13.5px] font-medium text-[#104C91] shadow-[0_4px_12px_rgba(15,65,130,0.08)] transition-colors hover:border-[#C5DDF4] hover:bg-[#FAFDFE]"
              >
                <span className="inline-flex items-center gap-2">
                  <GlobeOutlineIcon />
                  <span>{copy.languageLabel}</span>
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className={`h-3.5 w-3.5 text-[#2B5B96] transition-transform duration-150 ${
                    langMenuOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {langMenuOpen && (
                <div
                  role="listbox"
                  aria-label="Select language"
                  className="absolute right-0 z-30 mt-2 w-[164px] overflow-hidden rounded-2xl border border-[#D8E7F6] bg-white py-1.5 shadow-[0_12px_28px_-6px_rgba(10,56,118,0.18)]"
                >
                  {(
                    [
                      { code: 'en', label: 'English' },
                      { code: 'sw', label: 'Kiswahili' },
                    ] as const
                  ).map((option) => {
                    const selected = language === option.code;
                    return (
                      <button
                        key={option.code}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => handleLanguageSelect(option.code)}
                        className={`flex w-full items-center justify-between px-4 py-2 text-left text-[13.5px] transition-colors ${
                          selected
                            ? 'bg-[#EFF7FF] font-semibold text-[#0755A4]'
                            : 'font-medium text-[#2A4B7F] hover:bg-[#F6FAFE]'
                        }`}
                      >
                        <span>{option.label}</span>
                        {selected && <Check className="h-3.5 w-3.5 text-[#078CF0]" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Main Centered Login Column */}
          <div className="mx-auto flex w-full max-w-[472px] flex-1 flex-col justify-center pt-3 xl:flex-none xl:justify-start xl:pt-[16px]">
            {/* Top-center JaliCare logo */}
            <div className="flex justify-center">
              <JaliCareLogo className="w-[260px] sm:w-[295px] md:w-[265px] lg:w-[305px] xl:w-[328px]" />
            </div>

            {/* Welcome Heading */}
            <h2 className="mt-6 text-center text-[25px] font-bold leading-tight tracking-[-0.015em] text-[#063B82] lg:mt-8 lg:text-[27px] xl:mt-[34px] xl:text-[28px]">
              {copy.welcomeHeading}
            </h2>
            <p className="mt-2 text-center text-[13.5px] font-normal text-[#2A4B7F] xl:mt-[9px] xl:text-[14.5px]">
              {copy.welcomeSubheading}
            </p>

            {/* Authentication Error / Status Banners */}
            {error && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2.5 rounded-[14px] border border-rose-200 bg-rose-50/95 px-4 py-3 text-[13px] leading-snug text-rose-800 shadow-xs"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                <span className="flex-1">{error}</span>
                <button
                  type="button"
                  onClick={() => setError('')}
                  aria-label="Dismiss error"
                  className="rounded p-0.5 text-rose-500 hover:bg-rose-100 hover:text-rose-700"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {infoMessage && (
              <div
                role="status"
                className="mt-4 flex items-start gap-2.5 rounded-[14px] border border-[#BFE0FB] bg-[#EFF8FF] px-4 py-3 text-[13px] leading-snug text-[#084488]"
              >
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#0777E1]" />
                <span className="flex-1">{infoMessage}</span>
              </div>
            )}

            {altAuthNotice && (
              <div
                role="status"
                className="mt-4 flex items-start gap-2.5 rounded-[14px] border border-[#C6E1FA] bg-[#F2F9FF] px-4 py-3 text-[12.5px] leading-relaxed text-[#14437A]"
              >
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#0777E1]" />
                <div className="flex-1">
                  <p className="font-semibold text-[#063B82]">{altAuthNotice.title}</p>
                  <p className="mt-0.5 text-[#2A4B7F]">{altAuthNotice.message}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setAltAuthNotice(null)}
                  aria-label="Dismiss notice"
                  className="rounded p-0.5 text-[#4B72A6] hover:bg-[#E2F0FC] hover:text-[#063B82]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* Login Form */}
            <form onSubmit={handleSubmit} noValidate className="mt-6 xl:mt-[26px]">
              {/* Username or Email */}
              <div>
                <label htmlFor="identifier" className="sr-only">
                  {copy.usernameLabel}
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-[20px] top-1/2 -translate-y-1/2">
                    <UserOutlineIcon />
                  </span>
                  <input
                    id="identifier"
                    name="identifier"
                    type="text"
                    autoComplete="username"
                    value={identifier}
                    onChange={(event) => {
                      setIdentifier(event.target.value);
                      if (error) setError('');
                    }}
                    disabled={loading}
                    placeholder={copy.usernamePlaceholder}
                    className="jalicare-input h-[54px] w-full rounded-[15px] pl-[54px] pr-4 text-[15px] font-normal text-[#0B2E59] placeholder:text-[#869DBC] disabled:cursor-not-allowed disabled:opacity-65 xl:h-[60px]"
                  />
                </div>
              </div>

              {/* Password */}
              <div className="mt-4 xl:mt-[21px]">
                <label htmlFor="password" className="sr-only">
                  {copy.passwordLabel}
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-[20px] top-1/2 -translate-y-1/2">
                    <LockOutlineIcon />
                  </span>
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      if (error) setError('');
                    }}
                    disabled={loading}
                    placeholder={copy.passwordPlaceholder}
                    className="jalicare-input h-[54px] w-full rounded-[15px] pl-[54px] pr-[52px] text-[15px] font-normal text-[#0B2E59] placeholder:text-[#869DBC] disabled:cursor-not-allowed disabled:opacity-65 xl:h-[60px]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    disabled={loading}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-[14px] top-1/2 -translate-y-1/2 rounded-lg p-2 text-[#2B5494] transition-colors hover:bg-[#EAF4FE] hover:text-[#0755A4] disabled:opacity-50"
                  >
                    {showPassword ? (
                      <Eye className="h-[20px] w-[20px]" strokeWidth={1.8} />
                    ) : (
                      <EyeOff className="h-[20px] w-[20px]" strokeWidth={1.8} />
                    )}
                  </button>
                </div>
              </div>

              {/* Remember me & Forgot password? */}
              <div className="mt-4 flex items-center justify-between gap-3 xl:mt-[22px]">
                <label className="inline-flex cursor-pointer select-none items-center gap-2.5 text-[13.5px] font-medium text-[#1D4B8A] xl:text-[14px]">
                  <span className="relative inline-flex h-[18px] w-[18px] items-center justify-center">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(event) => handleRememberMeChange(event.target.checked)}
                      disabled={loading}
                      className="peer h-[18px] w-[18px] cursor-pointer appearance-none rounded-[4px] border border-[#8DA6C6] bg-white transition-colors checked:border-[#0777E1] checked:bg-[#0777E1] focus-visible:ring-2 focus-visible:ring-[#078CF0]/40 disabled:cursor-not-allowed"
                    />
                    <Check
                      aria-hidden="true"
                      className="pointer-events-none absolute h-3 w-3 text-white opacity-0 transition-opacity peer-checked:opacity-100"
                      strokeWidth={3}
                    />
                  </span>
                  <span>{copy.rememberMe}</span>
                </label>

                <button
                  type="button"
                  onClick={() => setForgotPasswordOpen(true)}
                  className="text-[13.5px] font-semibold text-[#0762E0] transition-colors hover:text-[#0548B0] hover:underline xl:text-[14px]"
                >
                  {copy.forgotPassword}
                </button>
              </div>

              {/* Primary Gradient Sign-In Button */}
              <button
                type="submit"
                disabled={loading}
                className="jalicare-signin-btn mt-7 inline-flex h-[52px] w-full cursor-pointer items-center justify-center gap-2.5 rounded-full px-6 text-[16px] font-semibold tracking-[0.005em] text-white disabled:cursor-not-allowed disabled:opacity-70 xl:mt-[36px] xl:h-[56px] xl:text-[16.5px]"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-[18px] w-[18px] animate-spin" />
                    <span>{copy.signingIn}</span>
                  </>
                ) : (
                  <>
                    <ArrowRight className="h-[18px] w-[18px]" strokeWidth={2.2} />
                    <span>{copy.signIn}</span>
                  </>
                )}
              </button>
            </form>

            {/* Alternative Login Divider */}
            <div className="mt-7 flex items-center gap-4 xl:mt-[38px]">
              <span aria-hidden="true" className="h-px flex-1 bg-[#D5E4F3]" />
              <span className="text-[13px] font-normal text-[#294F87] xl:text-[13.5px]">
                {copy.orContinueWith}
              </span>
              <span aria-hidden="true" className="h-px flex-1 bg-[#D5E4F3]" />
            </div>

            {/* Alternative Login Outline Buttons */}
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 md:gap-2.5 lg:gap-3.5 xl:mt-[23px] xl:gap-[26px]">
              <button
                type="button"
                disabled={loading}
                onClick={() => handleAlternativeLogin('biometric')}
                className="jalicare-alt-btn inline-flex h-[48px] w-full cursor-pointer items-center justify-center gap-2 rounded-full px-4 text-[13.5px] font-semibold text-[#072D74] disabled:cursor-not-allowed disabled:opacity-60 md:gap-1.5 md:px-2.5 md:text-[12px] lg:gap-2 lg:px-3 lg:text-[13px] xl:h-[51px] xl:gap-2.5 xl:px-4 xl:text-[14.5px]"
              >
                <BiometricFingerprintIcon />
                <span className="whitespace-nowrap">{copy.biometricLogin}</span>
              </button>

              <button
                type="button"
                disabled={loading}
                onClick={() => handleAlternativeLogin('smartcard')}
                className="jalicare-alt-btn inline-flex h-[48px] w-full cursor-pointer items-center justify-center gap-2 rounded-full px-4 text-[13.5px] font-semibold text-[#072D74] disabled:cursor-not-allowed disabled:opacity-60 md:gap-1.5 md:px-2.5 md:text-[12px] lg:gap-2 lg:px-3 lg:text-[13px] xl:h-[51px] xl:gap-2.5 xl:px-4 xl:text-[14.5px]"
              >
                <SmartCardChipIcon />
                <span className="whitespace-nowrap">{copy.smartCardLogin}</span>
              </button>
            </div>
          </div>

          {/* Bottom Security Footer */}
          <footer className="mt-7 flex flex-col items-center text-center xl:mt-[46px]">
            <div className="inline-flex items-center gap-2 text-[12.5px] font-medium text-[#335C99] xl:text-[13px]">
              <ProtectedShieldCheckIcon />
              <span>{copy.protectedData}</span>
            </div>
            <p className="mt-1.5 text-[12px] font-medium text-[#39619B] xl:text-[12.5px]">
              {copy.versionLabel}
            </p>
          </footer>
        </section>
      </div>

      {/* -----------------------------------------------------------------
          Forgot Password Assistance Modal
      ----------------------------------------------------------------- */}
      {forgotPasswordOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#06244F]/35 px-4 backdrop-blur-[3px]"
          onClick={() => setForgotPasswordOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={forgotModalTitleId}
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-[440px] rounded-[22px] border border-[#D4E6F8] bg-white p-6 shadow-[0_24px_48px_-12px_rgba(6,38,84,0.28)] sm:p-7"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <ProtectedShieldCheckIcon />
                <h3
                  id={forgotModalTitleId}
                  className="text-[18px] font-bold tracking-tight text-[#063B82]"
                >
                  {copy.forgotModalTitle}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setForgotPasswordOpen(false)}
                aria-label="Close password recovery dialog"
                className="rounded-lg p-1.5 text-[#4B72A6] transition-colors hover:bg-[#EFF7FF] hover:text-[#063B82]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="mt-2.5 text-[13.5px] font-medium text-[#234A80]">
              {copy.forgotModalSubtitle}
            </p>

            <div className="mt-4 space-y-2.5 rounded-2xl border border-[#DCEAF8] bg-[#F6FAFE] p-4 text-[13px] leading-relaxed text-[#2C4E80]">
              <p>{copy.forgotModalBody1}</p>
              <p>{copy.forgotModalBody2}</p>
            </div>

            {identifier.trim() && (
              <div className="mt-4 rounded-xl border border-[#E1EDF9] bg-white px-3.5 py-2.5 text-[12.5px] text-[#2A4B7F]">
                <span className="block text-[11.5px] font-medium text-[#5A7BA8]">
                  {copy.forgotModalAccountHint}
                </span>
                <span className="mt-0.5 block font-mono font-semibold text-[#063B82]">
                  {identifier.trim()}
                </span>
              </div>
            )}

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setForgotPasswordOpen(false)}
                className="jalicare-signin-btn inline-flex h-[44px] cursor-pointer items-center justify-center rounded-full px-6 text-[14px] font-semibold text-white"
              >
                {copy.forgotModalClose}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
};
