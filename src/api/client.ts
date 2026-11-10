import axios from 'axios'
import { env } from '@/config/env'

export const apiClient = axios.create({
  baseURL: env.apiBaseUrl,
  timeout: env.apiTimeout,
  headers: { 'Content-Type': 'application/json' },
})

// TODO: 인증 토큰 헤더 주입 / 공통 에러 처리
apiClient.interceptors.response.use(
  (response) => response,
  (error) => Promise.reject(error),
)
