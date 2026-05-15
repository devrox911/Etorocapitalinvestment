import { FormEvent, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'

type Status =
  | { state: 'idle' }
  | { state: 'loading'; message: string }
  | { state: 'error'; message: string }
  | { state: 'success'; message: string }

function Login() {
  const [form, setForm] = useState({ email: '', password: '' })
  const [status, setStatus] = useState<Status>({ state: 'idle' })
  const [showPassword, setShowPassword] = useState(false)
  const submitInFlightRef = useRef(false)
  const { login } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitInFlightRef.current) return
    submitInFlightRef.current = true
    setStatus({ state: 'loading', message: 'Authenticating…' })

    try {
      // Use the updated login function that returns redirect info
      const result = await login(form.email, form.password)

      if (!result.success) {
        setStatus({ state: 'error', message: 'Invalid email/username or password' })
        submitInFlightRef.current = false
        return
      }

      // Get user data for display purposes
      const userData = localStorage.getItem('activeUser')
      const user = userData ? JSON.parse(userData) : null

      // Add login notification to user's notifications
      const loginNotification = {
        id: Date.now(),
        title: 'Login Successful',
        message: `You logged in from ${navigator.userAgent.includes('Windows') ? 'Windows' : navigator.userAgent.includes('Mac') ? 'Mac' : 'Unknown'} device on ${new Date().toLocaleString()}`,
        type: 'success',
        read: false,
        created_at: new Date().toISOString()
      }
      const storedNotifications = JSON.parse(localStorage.getItem('userNotifications') || '[]')
      storedNotifications.unshift(loginNotification)
      localStorage.setItem('userNotifications', JSON.stringify(storedNotifications.slice(0, 50)))

      // Redirect to the appropriate dashboard based on role
      const redirectPath = result.redirectTo || '/dashboard'
      const userType = user?.role || 'user'

      setStatus({ state: 'success', message: `Welcome ${userType}! Redirecting to dashboard…` })
      setTimeout(() => { window.location.href = redirectPath }, 1000)
    } catch (error: any) {
      setStatus({ state: 'error', message: error?.message || 'Login failed. Please try again.' })
      submitInFlightRef.current = false
    }
  }

  return (
    <div className="binance-auth">
      <div className="binance-auth__container">
        <Link to="/" className="binance-auth__logo">
          <img src="/images/big.png" alt="eToro Trust Capital" />
        </Link>
        
        <div className="binance-auth__header">
          <h1>Log In</h1>
          <p>Welcome back to eToro Trust Capital Investments</p>
        </div>

        <form className="binance-form" onSubmit={handleSubmit}>
          <div className="binance-form__group">
            <label htmlFor="email">Email or Username</label>
            <input
              id="email"
              type="text"
              placeholder="Enter your email or username"
              value={form.email}
              onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
              required
            />
          </div>

          <div className="binance-form__group">
            <label htmlFor="password">Password</label>
            <div className="binance-form__password">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Enter your password"
                value={form.password}
                onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
                required
              />
              <button
                type="button"
                className="binance-form__toggle"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? '👁️' : '👁️‍🗨️'}
              </button>
            </div>
          </div>

          {status.state !== 'idle' && (
            <div className={`binance-form__status binance-form__status--${status.state}`}>
              {status.message}
            </div>
          )}

          <button 
            className="binance-form__submit" 
            type="submit" 
            disabled={status.state === 'loading'}
          >
            {status.state === 'loading' ? 'Logging in...' : 'Log In'}
          </button>
        </form>

        <div className="binance-auth__footer">
          New to eToro Trust Capital? <Link to="/signup">Sign Up</Link>
        </div>
        
        <div style={{
          marginTop: '1.5rem',
          paddingTop: '1.5rem',
          borderTop: '1px solid rgba(255,255,255,0.1)',
          textAlign: 'center'
        }}>
          <Link 
            to="/admin/login" 
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              color: '#a78bfa',
              fontSize: '0.875rem',
              textDecoration: 'none',
              transition: 'color 0.2s'
            }}
          >
            <span>🛡️</span>
            Administrator Login
          </Link>
        </div>
      </div>
    </div>
  )
}

export default Login
