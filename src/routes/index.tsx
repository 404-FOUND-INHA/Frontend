import { createBrowserRouter } from 'react-router-dom'
import MainLayout from '@/layouts/MainLayout'
import HomePage from '@/pages/HomePage'
import NotFoundPage from '@/pages/NotFoundPage'
import SplashPage from '@/pages/onboarding/SplashPage'
import OnboardingPage from '@/pages/onboarding/OnboardingPage'

export const router = createBrowserRouter([
  { path: '/splash', element: <SplashPage /> },
  { path: '/onboarding', element: <OnboardingPage /> },
  {
    path: '/',
    element: <MainLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
