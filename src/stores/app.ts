import type { EarthViewMode, NodeViewMode, PublicSettings, ThemeMode } from '@/utils/api'
import type { ByteDecimalsConfig } from '@/utils/helper'
import { usePreferredDark, useStorageAsync } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

export type { ThemeMode }
type Lang = 'zh-CN' | 'en-US'

/** 固定的字节精度配置 */
const BYTE_DECIMALS: ByteDecimalsConfig = {
  B: 0,
  KB: 0,
  MB: 1,
  GB: 1,
  TB: 2,
}

function isValidThemeMode(value: unknown): value is ThemeMode {
  return value === 'auto' || value === 'light' || value === 'dark'
}

const useAppStore = defineStore('app', () => {
  const loading = ref<boolean>(true)

  // 使用 VueUse 的 useStorageAsync 实现自动持久化；null 表示用户未手动选择，回退到服务端默认主题模式
  const storedThemeMode = useStorageAsync<ThemeMode | null>('themeMode', null, localStorage)
  const lang = ref<Lang>('zh-CN')
  const publicSettings = ref<PublicSettings>()
  const nodeSelectedGroup = useStorageAsync<string>('nodeSelectedGroup', 'all', localStorage)
  const isLoggedIn = ref<boolean>(false)
  const connectionError = ref<boolean>(false)

  /**
   * 后端站点开关 sysConfig.show_price：访客是否可见价格/价值信息。
   * 旧版后端不返回该字段时视为开启（与内置主题 `?? true` 一致）。
   */
  const showPrice = ref<boolean>(true)

  /**
   * 当前请求方是否可见价格/价值信息。
   * 管理员（已登录，/api/config 返回 authorization）不受 show_price 影响。
   */
  const canViewPrice = computed<boolean>(() => showPrice.value || isLoggedIn.value)

  // 首页滚动位置记忆
  const homeScrollPosition = ref<number>(0)

  // 使用 null 表示未设置，等待主题配置加载后决定
  const storedViewMode = useStorageAsync<NodeViewMode | null>('nodeViewMode', null, localStorage)

  // 计算属性：从主题配置获取默认视图模式
  const defaultViewMode = computed<NodeViewMode>(() => {
    return publicSettings.value?.themeSettings.defaultViewMode ?? 'card'
  })

  // 计算属性：从主题配置获取默认主题模式
  const defaultThemeMode = computed<ThemeMode>(() => {
    return publicSettings.value?.themeSettings.defaultThemeMode ?? 'auto'
  })

  // 校验视图模式是否为合法值
  function isValidViewMode(value: string | null): value is NodeViewMode {
    return value === 'card' || value === 'list'
  }

  // 当前实际使用的视图模式
  const nodeViewMode = computed<NodeViewMode>({
    get: () => {
      // 校验 storedViewMode 是否为合法值，非法值时使用默认值
      if (storedViewMode.value !== null && isValidViewMode(storedViewMode.value)) {
        return storedViewMode.value
      }
      return defaultViewMode.value
    },
    set: (val) => {
      storedViewMode.value = val
    },
  })

  // 字节格式化精度（固定配置）
  const byteDecimals: ByteDecimalsConfig = { ...BYTE_DECIMALS }

  // 计算属性：公告配置
  const alertEnabled = computed<boolean>(() => {
    return publicSettings.value?.themeSettings.alertEnabled ?? false
  })

  const alertTitle = computed<string>(() => {
    return publicSettings.value?.themeSettings.alertTitle ?? ''
  })

  const alertContent = computed<string>(() => {
    return publicSettings.value?.themeSettings.alertContent ?? ''
  })

  const visitorCountryCode = ref<string | null>(null)

  const earthViewMode = computed<EarthViewMode>(() => {
    return publicSettings.value?.themeSettings.earthViewMode ?? 'earth'
  })

  const visitorInfoCardEnabled = computed<boolean>(() => {
    return publicSettings.value?.themeSettings.visitorInfoCardEnabled ?? true
  })

  const hideAdminEntryWhenLoggedOut = computed<boolean>(() => {
    return publicSettings.value?.themeSettings.hideAdminEntryWhenLoggedOut ?? false
  })

  const disablePageAnimation = computed<boolean>(() => {
    return publicSettings.value?.themeSettings.disablePageAnimation ?? false
  })

  // 计算属性：离线节点后置（默认顺序下离线节点排到所有节点最后）
  const offlineNodesLast = computed<boolean>(() => {
    return publicSettings.value?.themeSettings.offlineNodesLast ?? false
  })

  // 计算属性：ICP 备案配置
  const icpEnabled = computed<boolean>(() => {
    return publicSettings.value?.themeSettings.icpEnabled ?? false
  })

  const icpNumber = computed<string>(() => {
    return publicSettings.value?.themeSettings.icpNumber ?? ''
  })

  const icpUrl = computed<string>(() => {
    return publicSettings.value?.themeSettings.icpUrl || 'https://beian.miit.gov.cn/'
  })

  // 计算属性：公安备案配置
  const policeEnabled = computed<boolean>(() => {
    return publicSettings.value?.themeSettings.policeEnabled ?? false
  })

  const policeNumber = computed<string>(() => {
    return publicSettings.value?.themeSettings.policeNumber ?? ''
  })

  const policeUrl = computed<string>(() => {
    return publicSettings.value?.themeSettings.policeUrl ?? ''
  })

  /**
   * 新版后端把站点背景直接注入为 body 的 background-image（iOS 特判下为 body::after）。
   * 页面加载时检测一次；注入存在时视为已启用背景。
   */
  const injectedBodyBackground = ref((() => {
    if (typeof document === 'undefined')
      return false
    const body = getComputedStyle(document.body)
    if (body.backgroundImage && body.backgroundImage !== 'none')
      return true
    const after = getComputedStyle(document.body, '::after')
    return !!(after.backgroundImage && after.backgroundImage !== 'none')
  })())

  // 计算属性：自定义背景配置
  const backgroundEnabled = computed<boolean>(() => {
    return (publicSettings.value?.themeSettings.backgroundEnabled ?? false) || injectedBodyBackground.value
  })

  const backgroundType = computed<'image' | 'video'>(() => {
    return publicSettings.value?.themeSettings.backgroundType ?? 'image'
  })

  const lightBackgroundUrl = computed<string>(() => {
    return publicSettings.value?.themeSettings.lightBackgroundUrl ?? ''
  })

  const darkBackgroundUrl = computed<string>(() => {
    return publicSettings.value?.themeSettings.darkBackgroundUrl ?? ''
  })

  const backgroundBlur = computed<number>(() => {
    return publicSettings.value?.themeSettings.backgroundBlur ?? 0
  })

  const backgroundOverlay = computed<number>(() => {
    return publicSettings.value?.themeSettings.backgroundOverlay ?? 0
  })

  // 当 publicSettings 加载后，如果 localStorage 没有保存过视图模式或值为非法值，使用默认值
  watch(publicSettings, (settings) => {
    if (settings && !isValidViewMode(storedViewMode.value)) {
      // 触发 computed setter，会自动保存到 localStorage
      storedViewMode.value = defaultViewMode.value
    }
  }, { immediate: true })

  // 使用 VueUse 的 usePreferredDark 检测系统主题偏好
  const prefersDark = usePreferredDark()

  // 校验存储的主题模式；非法值时清除，回退到默认主题模式
  watch(storedThemeMode, (mode) => {
    if (mode !== null && !isValidThemeMode(mode)) {
      storedThemeMode.value = null
    }
  }, { immediate: true })

  // 当前实际使用的主题模式：用户手动选择优先，未选择时使用服务端默认主题模式
  const themeMode = computed<ThemeMode>({
    get: () => {
      if (storedThemeMode.value !== null && isValidThemeMode(storedThemeMode.value)) {
        return storedThemeMode.value
      }
      return defaultThemeMode.value
    },
    set: (val) => {
      storedThemeMode.value = val
    },
  })

  // 计算当前是否为暗色模式
  const isDark = computed(() => {
    if (themeMode.value === 'auto') {
      return prefersDark.value
    }
    return themeMode.value === 'dark'
  })

  const resolvedThemeMode = computed<'light' | 'dark'>(() => isDark.value ? 'dark' : 'light')

  // 计算属性：当前主题模式下的背景 URL
  const currentBackgroundUrl = computed<string>(() => {
    if (!backgroundEnabled.value) {
      return ''
    }

    if (resolvedThemeMode.value === 'dark') {
      return darkBackgroundUrl.value
    }
    return lightBackgroundUrl.value
  })

  function updateThemeMode(mode?: ThemeMode) {
    if (mode) {
      themeMode.value = isValidThemeMode(mode) ? mode : 'auto'
      return
    }

    const nextMode: Record<ThemeMode, ThemeMode> = {
      auto: 'light',
      light: 'dark',
      dark: 'auto',
    }

    const currentMode = isValidThemeMode(themeMode.value) ? themeMode.value : 'auto'
    themeMode.value = nextMode[currentMode]
  }

  function updateLoginState(loggedIn: boolean) {
    isLoggedIn.value = loggedIn
  }

  /**
   * 记录 /api/servers 的 sysConfig.show_price。
   * undefined（旧版后端不返回该字段）按 true 处理。
   */
  function updateShowPrice(value?: boolean) {
    showPrice.value = value ?? true
  }

  return {
    loading,
    themeMode,
    isDark,
    resolvedThemeMode,
    lang,
    nodeSelectedGroup,
    nodeViewMode,
    defaultViewMode,
    defaultThemeMode,
    byteDecimals,
    alertEnabled,
    alertTitle,
    alertContent,
    earthViewMode,
    visitorInfoCardEnabled,
    visitorCountryCode,
    hideAdminEntryWhenLoggedOut,
    disablePageAnimation,
    offlineNodesLast,
    icpEnabled,
    icpNumber,
    icpUrl,
    policeEnabled,
    policeNumber,
    policeUrl,
    backgroundEnabled,
    injectedBodyBackground,
    backgroundType,
    lightBackgroundUrl,
    darkBackgroundUrl,
    currentBackgroundUrl,
    backgroundBlur,
    backgroundOverlay,
    isLoggedIn,
    showPrice,
    canViewPrice,
    publicSettings,
    connectionError,
    homeScrollPosition,
    updateThemeMode,
    updateLoginState,
    updateShowPrice,
  }
})

export { useAppStore }
