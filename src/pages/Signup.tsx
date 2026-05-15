import { FormEvent, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'

type Status =
  | { state: 'idle' }
  | { state: 'loading'; message: string }
  | { state: 'error'; message: string }
  | { state: 'success'; message: string }

function Signup() {
  const [form, setForm] = useState({ 
    email: '', 
    fullName: '',
    userName: '',
    phoneNumber: '',
    password: '', 
    confirmPassword: '', 
    referralCode: '',
    isHuman: false,
    terms: false 
  })
  const [status, setStatus] = useState<Status>({ state: 'idle' })
  const [showPassword, setShowPassword] = useState(false)
  const submitInFlightRef = useRef(false)
  const [searchParams] = useSearchParams()
  const { signup } = useAuth()
  const navigate = useNavigate()

  // Read referral code from URL query parameter
  useEffect(() => {
    const refCode = searchParams.get('ref')
    if (refCode) {
      setForm((prev) => ({ ...prev, referralCode: refCode }))
    }
  }, [searchParams])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitInFlightRef.current) return

    if (form.password !== form.confirmPassword) {
      setStatus({ state: 'error', message: 'Passwords do not match' })
      return
    }

    if (!form.isHuman) {
      setStatus({ state: 'error', message: 'Please verify that you are human' })
      return
    }

    if (!form.terms) {
      setStatus({ state: 'error', message: 'Please accept the Terms of Service' })
      return
    }

    if (form.password.length < 8) {
      setStatus({ state: 'error', message: 'Password must be at least 8 characters' })
      return
    }

    submitInFlightRef.current = true
    setStatus({ state: 'loading', message: 'Creating your account…' })

    try {
      // Create account with Supabase
      await signup(form.email, form.password, {
        name: form.fullName,
        userName: form.userName,
        phoneNumber: form.phoneNumber,
        referredByCode: form.referralCode || undefined,
      })

      setStatus({ state: 'success', message: 'Account created! Redirecting to dashboard…' })
      setTimeout(() => navigate('/dashboard'), 1500)
    } catch (error: any) {
      console.error('Account creation error:', error)
      let errorMessage = 'Account creation failed. Please try again.'
      
      // Handle specific error types
      if (error?.message) {
        if (error.message.includes('Email already registered')) {
          errorMessage = 'This email is already registered. Please login instead.'
        } else if (error.message.includes('duplicate key')) {
          errorMessage = 'This email or username is already taken.'
        } else if (error.message.includes('fetch')) {
          errorMessage = 'Unable to connect to the server. Please check your internet connection.'
        } else {
          errorMessage = error.message
        }
      }
      
      setStatus({ state: 'error', message: errorMessage })
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
          <h1>Sign Up</h1>
          <p>Create your account to start investing</p>
        </div>

        <form className="binance-form" onSubmit={handleSubmit}>
          <div className="binance-form__group">
            <label htmlFor="fullName">Full Name</label>
            <input
              id="fullName"
              type="text"
              placeholder="Enter your full name"
              value={form.fullName}
              onChange={(e) => setForm((prev) => ({ ...prev, fullName: e.target.value }))}
              required
            />
          </div>

          <div className="binance-form__group">
            <label htmlFor="userName">Username</label>
            <input
              id="userName"
              type="text"
              placeholder="Choose a username"
              value={form.userName}
              onChange={(e) => setForm((prev) => ({ ...prev, userName: e.target.value }))}
              required
            />
          </div>

          <div className="binance-form__group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              placeholder="Enter your email"
              value={form.email}
              onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
              required
            />
          </div>

          <div className="binance-form__group">
            <label htmlFor="phoneNumber">Phone Number</label>
            <input
              id="phoneNumber"
              type="tel"
              placeholder="Enter your phone number"
              value={form.phoneNumber}
              onChange={(e) => setForm((prev) => ({ ...prev, phoneNumber: e.target.value }))}
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
                minLength={8}
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

          <div className="binance-form__group">
            <label htmlFor="confirmPassword">Confirm Password</label>
            <input
              id="confirmPassword"
              type={showPassword ? 'text' : 'password'}
              placeholder="Confirm your password"
              value={form.confirmPassword}
              onChange={(e) => setForm((prev) => ({ ...prev, confirmPassword: e.target.value }))}
              minLength={8}
              required
            />
          </div>

          <div className="binance-form__group">
            <label htmlFor="referralCode">Referral Code (Optional)</label>
            <input
              id="referralCode"
              type="text"
              placeholder="Enter referral code if you have one"
              value={form.referralCode}
              onChange={(e) => setForm((prev) => ({ ...prev, referralCode: e.target.value }))}
            />
          </div>

          <div className="binance-form__checkbox">
            <input
              id="isHuman"
              type="checkbox"
              checked={form.isHuman}
              onChange={(e) => setForm((prev) => ({ ...prev, isHuman: e.target.checked }))}
              required
            />
            <label htmlFor="isHuman">
              ✓ I am not a robot
            </label>
          </div>

          <div className="binance-form__checkbox">
            <input
              id="terms"
              type="checkbox"
              checked={form.terms}
              onChange={(e) => setForm((prev) => ({ ...prev, terms: e.target.checked }))}
              required
            />
            <label htmlFor="terms">
              I agree to eToro Trust Capital's <a href="/terms.html" target="_blank" rel="noreferrer">Terms of Service</a> and <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>
            </label>
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
            {status.state === 'loading' ? 'Creating Account...' : 'Sign Up'}
          </button>
        </form>

        <div className="binance-auth__footer">
          Already have an account? <Link to="/login">Log In</Link>
        </div>
      </div>
    </div>
  )
}

export default Signup
