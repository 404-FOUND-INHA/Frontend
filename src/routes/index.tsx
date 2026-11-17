import { createBrowserRouter, redirect } from 'react-router-dom'
import MainLayout from '@/layouts/MainLayout'
import HomePage from '@/pages/HomePage'
import NotFoundPage from '@/pages/NotFoundPage'
import SplashPage from '@/pages/onboarding/SplashPage'
import OnboardingPage from '@/pages/onboarding/OnboardingPage'
import LoginPage from '@/pages/auth/LoginPage'
import SignupPage from '@/pages/auth/SignupPage'
import SignupCompletePage from '@/pages/auth/SignupCompletePage'
import { hasSeenOnboarding } from '@/utils/onboarding'

export const router = createBrowserRouter([
  { path: '/splash', element: <SplashPage /> },
  { path: '/onboarding', element: <OnboardingPage /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignupPage /> },
  { path: '/signup/complete', element: <SignupCompletePage /> },
  {
    path: '/',
    element: <MainLayout />,
    loader: () => (hasSeenOnboarding() ? null : redirect('/splash')),
    children: [
      { index: true, element: <HomePage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
