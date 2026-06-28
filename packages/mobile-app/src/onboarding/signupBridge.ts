import { Linking, Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants from 'expo-constants'

export type SignupReturnMode = 'capable' | 'limited' | 'auto'

interface SignupIntent {
  state: string
  source: 'card' | 'footer'
  createdAt: string
  returnMode: SignupReturnMode
}

interface SignupBridgeConfig {
  signupUrl: string
  returnMode: SignupReturnMode
  returnParam: string
  stateParam: string
  supportsReturn: boolean
}

const SIGNUP_INTENT_STORAGE_KEY = 'solid.signupIntent.v1'
const SIGNUP_RETURN_FLAG_PARAM = 'nzSignupReturn'
const DEFAULT_RETURN_PARAM = 'returnTo'
const DEFAULT_STATE_PARAM = 'nzSignupState'
const SIGNUP_INTENT_MAX_AGE_MS = 30 * 60_000

function getSignupBridgeConfig(): SignupBridgeConfig {
  const appExtra = Constants.expoConfig?.extra as Record<string, string> | undefined
  const rawMode = appExtra?.solidSignupReturnMode?.trim().toLowerCase() ?? 'auto'
  const returnMode: SignupReturnMode =
    rawMode === 'capable' || rawMode === 'limited' || rawMode === 'auto' ? rawMode : 'auto'

  return {
    signupUrl: appExtra?.solidSignupUrl?.trim() || 'https://solidcommunity.net/register',
    returnMode,
    returnParam: appExtra?.solidSignupReturnParam?.trim() || DEFAULT_RETURN_PARAM,
    stateParam: appExtra?.solidSignupStateParam?.trim() || DEFAULT_STATE_PARAM,
    supportsReturn: (appExtra?.solidSignupSupportsReturn ?? '').trim().toLowerCase() === 'true',
  }
}

function shouldAttachReturnParams(config: SignupBridgeConfig): boolean {
  if (config.returnMode === 'limited') return false
  if (config.returnMode === 'capable') return true
  return config.supportsReturn
}

function createIntentState(): string {
  return `nz-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function buildReturnUrl(state: string, stateParam: string): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) {
    const returnUrl = new URL('/', window.location.origin)
    returnUrl.searchParams.set(SIGNUP_RETURN_FLAG_PARAM, '1')
    returnUrl.searchParams.set(stateParam, state)
    return returnUrl.toString()
  }

  return `nodezero://auth/callback?${SIGNUP_RETURN_FLAG_PARAM}=1&${stateParam}=${encodeURIComponent(state)}`
}

async function readSignupIntent(): Promise<SignupIntent | null> {
  const raw = await AsyncStorage.getItem(SIGNUP_INTENT_STORAGE_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<SignupIntent>
    if (
      typeof parsed.state !== 'string' ||
      typeof parsed.source !== 'string' ||
      typeof parsed.createdAt !== 'string' ||
      typeof parsed.returnMode !== 'string'
    ) {
      await AsyncStorage.removeItem(SIGNUP_INTENT_STORAGE_KEY)
      return null
    }

    const createdAtMs = new Date(parsed.createdAt).getTime()
    if (!Number.isFinite(createdAtMs) || Date.now() - createdAtMs > SIGNUP_INTENT_MAX_AGE_MS) {
      await AsyncStorage.removeItem(SIGNUP_INTENT_STORAGE_KEY)
      return null
    }

    const mode = parsed.returnMode
    if (mode !== 'capable' && mode !== 'limited' && mode !== 'auto') {
      await AsyncStorage.removeItem(SIGNUP_INTENT_STORAGE_KEY)
      return null
    }

    return {
      state: parsed.state,
      source: parsed.source === 'footer' ? 'footer' : 'card',
      createdAt: parsed.createdAt,
      returnMode: mode,
    }
  } catch {
    await AsyncStorage.removeItem(SIGNUP_INTENT_STORAGE_KEY)
    return null
  }
}

export async function clearSignupIntent(): Promise<void> {
  await AsyncStorage.removeItem(SIGNUP_INTENT_STORAGE_KEY)
}

export async function beginSolidSignup(source: 'card' | 'footer'): Promise<void> {
  const config = getSignupBridgeConfig()
  const state = createIntentState()

  const intent: SignupIntent = {
    state,
    source,
    createdAt: new Date().toISOString(),
    returnMode: config.returnMode,
  }
  await AsyncStorage.setItem(SIGNUP_INTENT_STORAGE_KEY, JSON.stringify(intent))

  const target = new URL(config.signupUrl)
  if (shouldAttachReturnParams(config)) {
    const returnUrl = buildReturnUrl(state, config.stateParam)
    target.searchParams.set(config.returnParam, returnUrl)
    target.searchParams.set(config.stateParam, state)
    target.searchParams.set(SIGNUP_RETURN_FLAG_PARAM, '1')
  }

  await Linking.openURL(target.toString())
}

export async function getSignupResumeState(): Promise<{
  hasActiveIntent: boolean
  returnDetected: boolean
}> {
  const intent = await readSignupIntent()
  if (!intent) {
    return {
      hasActiveIntent: false,
      returnDetected: false,
    }
  }

  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return {
      hasActiveIntent: true,
      returnDetected: false,
    }
  }

  const config = getSignupBridgeConfig()
  const params = new URLSearchParams(window.location.search)
  const returnFlag = params.get(SIGNUP_RETURN_FLAG_PARAM) === '1'
  const stateParam = params.get(config.stateParam)
  const stateMatches = !stateParam || stateParam === intent.state

  return {
    hasActiveIntent: true,
    returnDetected: stateMatches && (returnFlag || Boolean(stateParam)),
  }
}