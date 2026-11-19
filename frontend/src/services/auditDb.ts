import { safeLocalStorageSetItem } from "../utils/storageQuotaManager"

export interface AuditLog {
  id: string
  userId: string
  username: string
  action: string
  module: string
  description: string
  timestamp: string
  status: "Success" | "Failed"
  device?: string
  loginTime?: string
  logoutTime?: string
  duration?: string
  sessionId?: string
}

let _cachedDetectDevice: string | null = null

export function detectDevice(): string {
  if (_cachedDetectDevice) return _cachedDetectDevice
  if (typeof navigator === "undefined") {
    _cachedDetectDevice = "Desktop Client"
    return "Desktop Client"
  }

  const ua = navigator.userAgent || ""
  const platform = navigator.platform || ""
  const vendor = navigator.vendor || ""
  const uad = (navigator as any).userAgentData

  // 1. Detect Browser
  let browser = "Browser"
  if (/Edg\//i.test(ua)) {
    browser = "Edge"
  } else if (/OPR\/|Opera/i.test(ua)) {
    browser = "Opera"
  } else if (/Chrome\/|CriOS\//i.test(ua)) {
    browser = "Chrome"
  } else if (/Firefox\/|FxiOS\//i.test(ua)) {
    browser = "Firefox"
  } else if (/Safari/i.test(ua) && !/Chrome|CriOS|Android/i.test(ua)) {
    browser = "Safari"
  }

  let gpuRenderer = ""
  try {
    if (typeof document !== "undefined") {
      const canvas = document.createElement("canvas")
      const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl")
      if (gl) {
        const debugInfo = (gl as any).getExtension("WEBGL_debug_renderer_info")
        if (debugInfo) {
          gpuRenderer = (gl as any).getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || ""
        }
        try {
          const lose = (gl as any).getExtension("WEBGL_lose_context")
          lose?.loseContext()
        } catch {}
      }
    }
  } catch {
    // Ignore
  }

  const fullContext = `${ua} ${platform} ${vendor} ${gpuRenderer}`
  const isTouch = typeof navigator.maxTouchPoints === "number" && navigator.maxTouchPoints > 0
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (isTouch && /Android|Mobile/i.test(ua))

  // 2. Mobile / Tablet Platform Detection
  if (isMobile || /iPhone|iPad|iPod/i.test(ua)) {
    if (/iPhone/i.test(ua)) {
      _cachedDetectDevice = `Apple iPhone (${browser})`
      return _cachedDetectDevice
    }
    if (/iPad/i.test(ua)) {
      _cachedDetectDevice = `Apple iPad (${browser})`
      return _cachedDetectDevice
    }
    if (/Samsung|SM-[A-Z0-9]|Galaxy/i.test(fullContext)) {
      const m = ua.match(/SM-([A-Z0-9]+)/i)
      _cachedDetectDevice = m ? `Samsung Galaxy (${m[0]})` : `Samsung Galaxy (${browser})`
      return _cachedDetectDevice
    }
    if (/Pixel/i.test(fullContext)) {
      const m = ua.match(/Pixel\s*([0-9a-zA-Z\s]+)/i)
      _cachedDetectDevice = m ? `Google ${m[0]}` : `Google Pixel (${browser})`
      return _cachedDetectDevice
    }
    if (/OnePlus|ONEPLUS/i.test(fullContext)) {
      _cachedDetectDevice = `OnePlus Phone (${browser})`
      return _cachedDetectDevice
    }
    if (/Xiaomi|Redmi|Poco|Mi /i.test(fullContext)) {
      _cachedDetectDevice = `Xiaomi Phone (${browser})`
      return _cachedDetectDevice
    }
    if (/Vivo|V2\d{3}|V1\d{3}|V20|V21|V22|V23|V24|V25|V27|V29|V30|Y20|Y21|Y33|Y56|Y75|CPH/i.test(fullContext)) {
      _cachedDetectDevice = `Vivo Phone (${browser})`
      return _cachedDetectDevice
    }
    if (/Oppo/i.test(fullContext)) {
      _cachedDetectDevice = `Oppo Phone (${browser})`
      return _cachedDetectDevice
    }
    if (/Realme|RMX/i.test(fullContext)) {
      _cachedDetectDevice = `Realme Phone (${browser})`
      return _cachedDetectDevice
    }
    if (/Motorola|Moto/i.test(fullContext)) {
      _cachedDetectDevice = `Motorola Phone (${browser})`
      return _cachedDetectDevice
    }
    if (/Huawei|Honor/i.test(fullContext)) {
      _cachedDetectDevice = `Huawei Phone (${browser})`
      return _cachedDetectDevice
    }
    _cachedDetectDevice = `Android Phone (${browser})`
    return _cachedDetectDevice
  }

  // 3. Desktop / Laptop Platform Detection
  const isWindows = /Windows|Win32|Win64|Windows NT/i.test(ua) || (uad?.platform === "Windows") || /Win/i.test(platform)
  const isMac = !isWindows && (/Macintosh|Mac OS X|MacIntel/i.test(fullContext) || /Mac/i.test(platform))

  if (isWindows) {
    let winLabel = "Windows 11 PC"
    if (/Windows NT 6\.3/i.test(ua)) {
      winLabel = "Windows 8.1 PC"
    } else if (/Windows NT 6\.1/i.test(ua)) {
      winLabel = "Windows 7 PC"
    }

    const formFactor = isTouch ? "Laptop" : "PC"

    if (/Surface/i.test(fullContext)) {
      _cachedDetectDevice = `Microsoft Surface (${browser})`
      return _cachedDetectDevice
    }
    if (/Lenovo|ThinkPad|IdeaPad|Yoga|Legion/i.test(fullContext)) {
      _cachedDetectDevice = `Lenovo ${formFactor} (${browser})`
      return _cachedDetectDevice
    }
    if (/HP|Hewlett-Packard|Pavilion|EliteBook|ProBook|Envy|Spectre|OMEN/i.test(fullContext)) {
      _cachedDetectDevice = `HP ${formFactor} (${browser})`
      return _cachedDetectDevice
    }
    if (/Dell|Inspiron|Latitude|XPS|Alienware|Vostro/i.test(fullContext)) {
      _cachedDetectDevice = `Dell ${formFactor} (${browser})`
      return _cachedDetectDevice
    }
    if (/Asus|ROG|ZenBook|VivoBook/i.test(fullContext)) {
      _cachedDetectDevice = `Asus ${formFactor} (${browser})`
      return _cachedDetectDevice
    }
    if (/Acer|Predator|Aspire|Swift|Nitro/i.test(fullContext)) {
      _cachedDetectDevice = `Acer ${formFactor} (${browser})`
      return _cachedDetectDevice
    }
    if (/MSI/i.test(fullContext)) {
      _cachedDetectDevice = `MSI ${formFactor} (${browser})`
      return _cachedDetectDevice
    }
    if (/Samsung/i.test(fullContext)) {
      _cachedDetectDevice = `Samsung Galaxy Book (${browser})`
      return _cachedDetectDevice
    }

    _cachedDetectDevice = `${winLabel} (${browser})`
    return _cachedDetectDevice
  }

  if (isMac) {
    if (isTouch) {
      _cachedDetectDevice = `Apple iPad (${browser})`
      return _cachedDetectDevice
    }
    _cachedDetectDevice = `Apple Mac (${browser})`
    return _cachedDetectDevice
  }

  if (/CrOS/i.test(fullContext)) {
    _cachedDetectDevice = `Google Chromebook (${browser})`
    return _cachedDetectDevice
  }

  if (/Linux/i.test(fullContext)) {
    _cachedDetectDevice = `Linux Workstation (${browser})`
    return _cachedDetectDevice
  }

  _cachedDetectDevice = `Desktop PC (${browser})`
  return _cachedDetectDevice
}

export function formatTimeOnly(isoStr?: string): string {
  if (!isoStr) return "—"
  if (isoStr === "Active" || isoStr === "Session Expired" || isoStr === "—") return isoStr
  try {
    const d = new Date(isoStr)
    if (isNaN(d.getTime())) return isoStr
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  } catch {
    return isoStr
  }
}

export function formatDuration(startDate: Date, endDate: Date): string {
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return "—"
  let diffMs = Math.max(0, endDate.getTime() - startDate.getTime())
  let totalSeconds = Math.floor(diffMs / 1000)
  let seconds = totalSeconds % 60
  let minutes = Math.floor((totalSeconds / 60) % 60)
  let hours = Math.floor(totalSeconds / 3600)

  const parts: string[] = []
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0 || hours > 0) parts.push(`${minutes}m`)
  parts.push(`${seconds}s`)
  return parts.join(" ")
}

const STORAGE_KEY = "hospai_audit_logs_v1"

export class AuditDatabase {
  private static _cachedLogs: AuditLog[] | null = null

  static invalidateCache(): void {
    this._cachedLogs = null
  }
  static getRawLogs(): AuditLog[] {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed
        }
      } catch {
        // Fall through to default seed
      }
    }

    const defaultLogs: AuditLog[] = []

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultLogs))
    } catch {}

    return defaultLogs
  }

  static getLogs(): AuditLog[] {
    const rawLogs = this.getRawLogs()
    let currentUsername = ""
    try {
      const curData = localStorage.getItem("hospai_current_user")
      if (curData) {
        const u = JSON.parse(curData)
        if (u) currentUsername = u.name || u.user || u.profile?.name || u.profile?.username || ""
      }
    } catch {
      // Ignore
    }

    const now = new Date()
    const currentDetected = detectDevice()
    let updatedStorageNeeded = false

    const isActuallyMac =
      typeof navigator !== "undefined" &&
      /Macintosh|Mac OS X|MacIntel/i.test(navigator.userAgent || "") &&
      !/Windows/i.test(navigator.userAgent || "")

    const processedLogs = rawLogs.map((log) => {
      let device = log.device
      const isLegacyFakeDevice =
        !device ||
        device === "Windows PC" ||
        device === "Desktop Web Browser" ||
        (device === "Apple MacBook" && !isActuallyMac) ||
        (device === "Lenovo Laptop" && !/Lenovo|ThinkPad/i.test(navigator.userAgent || "")) ||
        (device === "Apple iPhone" && !/iPhone/i.test(navigator.userAgent || "")) ||
        (device === "Android Phone" && !/Android/i.test(navigator.userAgent || ""))

      if (isLegacyFakeDevice) {
        device = currentDetected
        log.device = currentDetected
        updatedStorageNeeded = true
      }

      if ((!log.username || log.username === "System") && currentUsername) {
        log.username = currentUsername
        updatedStorageNeeded = true
      }

      const isLoginSession =
        log.action.toLowerCase().includes("login") ||
        log.module === "Authentication"

      const loginTimeIso = log.loginTime || log.timestamp
      const loginDate = new Date(loginTimeIso)
      const isFailed = log.status === "Failed" || log.action.toLowerCase().includes("failed")

      if (isFailed) {
        return {
          ...log,
          device,
          loginTime: formatTimeOnly(loginTimeIso),
          logoutTime: "—",
          duration: "—",
        }
      }

      let logoutTimeState = log.logoutTime || "Active"
      let calculatedDuration = log.duration

      if (!isLoginSession) {
        return {
          ...log,
          device: device || currentDetected,
          loginTime: formatTimeOnly(loginTimeIso),
          logoutTime: logoutTimeState === "Active" ? "—" : logoutTimeState,
          duration: calculatedDuration || "15m 00s",
        }
      }

      if (!logoutTimeState || logoutTimeState === "Active") {
        const diffMins = (now.getTime() - loginDate.getTime()) / (1000 * 60)
        const matchesUser =
          !currentUsername ||
          currentUsername.toLowerCase() === log.username.toLowerCase() ||
          log.userId === currentUsername

        if (matchesUser && diffMins < 480) {
          logoutTimeState = "Active"
          calculatedDuration = formatDuration(loginDate, now)
        } else {
          logoutTimeState = "Session Expired"
          const expiryDate = new Date(loginDate.getTime() + Math.min(diffMins, 480) * 60 * 1000)
          calculatedDuration = formatDuration(loginDate, expiryDate)
        }
      } else if (logoutTimeState !== "Session Expired" && logoutTimeState !== "—") {
        const logoutDate = new Date(logoutTimeState)
        if (!isNaN(logoutDate.getTime())) {
          calculatedDuration = formatDuration(loginDate, logoutDate)
          logoutTimeState = formatTimeOnly(logoutTimeState)
        }
      }

      return {
        ...log,
        device,
        loginTime: formatTimeOnly(loginTimeIso),
        logoutTime: logoutTimeState,
        duration: calculatedDuration || "0s",
      }
    })

    if (updatedStorageNeeded) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(rawLogs))
      } catch {
        // Ignore
      }
    }

    return processedLogs
  }

  static recordLogout(username: string) {
    const logs = this.getRawLogs()
    const nowIso = new Date().toISOString()
    let updated = false

    for (const log of logs) {
      const isLogin = log.action === "Login Successful" || (log.module === "Authentication" && log.status === "Success")
      const isUserMatch =
        !username ||
        log.username.toLowerCase() === username.toLowerCase() ||
        log.userId === username ||
        username === "System" ||
        username === "Hospital Administrator"

      if (isLogin && isUserMatch && (!log.logoutTime || log.logoutTime === "Active")) {
        const loginDate = new Date(log.loginTime || log.timestamp)
        log.logoutTime = nowIso
        log.duration = formatDuration(loginDate, new Date(nowIso))
        updated = true
        break
      }
    }

    if (!updated) {
      for (const log of logs) {
        const isLogin = log.action === "Login Successful" || (log.module === "Authentication" && log.status === "Success")
        if (isLogin && (!log.logoutTime || log.logoutTime === "Active")) {
          const loginDate = new Date(log.loginTime || log.timestamp)
          log.logoutTime = nowIso
          log.duration = formatDuration(loginDate, new Date(nowIso))
          updated = true
          break
        }
      }
    }

    if (updated) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(logs))
      } catch (err) {
        console.warn("AuditDatabase: Unable to update logout in localStorage", err)
      }
    }
  }

  static logEvent(
    action: string,
    module: string,
    description: string,
    status: "Success" | "Failed",
    userId: string = "system",
    username: string = "System",
    device?: string,
  ) {
    if (action === "Logout" || action.toLowerCase().includes("logout")) {
      this.recordLogout(username !== "System" ? username : userId)
      return
    }

    const logs = this.getRawLogs()
    let finalUserId = userId
    let finalUsername = username

    if (finalUserId === "system" || finalUsername === "System") {
      try {
        const currentUserData = localStorage.getItem("hospai_current_user")
        if (currentUserData) {
          const u = JSON.parse(currentUserData)
          if (u) {
            finalUsername = u.name || u.user || u.profile?.name || u.profile?.username || finalUsername
            finalUserId = u.staffId || u.profile?.staffId || u.user || finalUserId
          }
        }
      } catch (e) {
        // Ignore
      }
    }

    const isLoginRelated = action.toLowerCase().includes("login") || module === "Authentication"
    const nowIso = new Date().toISOString()

    const entry: AuditLog = {
      id: "AUD_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
      userId: finalUserId,
      username: finalUsername,
      action,
      module,
      description,
      timestamp: nowIso,
      status,
      device: device || detectDevice(),
      loginTime: nowIso,
      logoutTime: isLoginRelated ? (status === "Success" ? "Active" : "—") : "—",
      duration: isLoginRelated ? (status === "Success" ? "0s" : "—") : "5m 00s",
    }

    try {
      logs.unshift(entry)
      if (logs.length > 30) {
        logs.splice(30)
      }
      safeLocalStorageSetItem(STORAGE_KEY, JSON.stringify(logs))
    } catch (e) {
      console.warn("AuditDatabase: Unable to persist log to localStorage, trimming to 10", e)
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(logs.slice(0, 10)))
      } catch {
        try { localStorage.removeItem(STORAGE_KEY) } catch {}
      }
    }
  }
}
