import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { supabaseDb, supabaseRealtime, supabase } from '@/lib/supabaseUtils'
import { 
  sendInvestmentNotification,
  sendWithdrawalNotification, 
  sendKYCNotification, 
  sendLoanNotification,
  sendBalanceUpdateNotification,
  sendDepositNotification
} from '@/utils/emailService'
import '../../styles/dashboard.css'
import '../../styles/modern-dashboard.css'

/**
 * ADMIN DASHBOARD
 *
 * HOW TO CREATE AN ADMIN USER:
 *
 * Option 1 - For Testing (Quick Setup):
 * 1. Create a regular account through the signup flow
 * 2. Login with that account
 * 3. Open browser DevTools (F12) → Console tab
 * 4. Run this command:
 *    ```javascript
 *    const user = JSON.parse(localStorage.getItem('activeUser'));
 *    user.role = 'admin'; // or 'superadmin' for full access
 *    localStorage.setItem('activeUser', JSON.stringify(user));
 *    location.reload();
 *    ```
 * 5. The "Admin Panel" link will now appear in your user dashboard sidebar
 *
 * Option 2 - Database Level (Production):
 * 1. In Supabase dashboard, navigate to your users table
 * 2. Find the user record you want to make admin
 * 3. Set role = 'admin' or 'superadmin' for that user
 * 4. User will see "Admin Panel" link after next login
 *
 * Option 3 - Code Level:
 * During signup/registration, set role: 'admin' or 'superadmin' in the user object
 * before saving to localStorage/sessionStorage or database
 *
 * Available roles: 'user', 'admin', 'superadmin'
 */

interface AdminDashboardProps {}

function AdminDashboard() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { logout } = useAuth()
  const [loading, setLoading] = useState(true)
  const [currentAdmin, setCurrentAdmin] = useState<any>(null)
  const [allUsers, setAllUsers] = useState<any[]>([])
  const [allInvestments, setAllInvestments] = useState<any[]>([])
  const [allWithdrawals, setAllWithdrawals] = useState<any[]>([])
  const [allKycRequests, setAllKycRequests] = useState<any[]>([])
  const [allLoans, setAllLoans] = useState<any[]>([])
  const [allDeposits, setAllDeposits] = useState<any[]>([]) // Added deposits state
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'investments' | 'deposits' | 'withdrawals' | 'kyc' | 'loans' | 'bonus' | 'settings'>('overview')
  const [showSidePanel, setShowSidePanel] = useState(false)
  const [selectedUser, setSelectedUser] = useState<any>(null)
  const [showUserModal, setShowUserModal] = useState(false)
  const [newBalance, setNewBalance] = useState('')
  const [balanceUpdateReason, setBalanceUpdateReason] = useState('')
  const [showAddBonusModal, setShowAddBonusModal] = useState(false)
  const [bonusAmount, setBonusAmount] = useState('')
  const [bonusReason, setBonusReason] = useState('')
  const [bonusType, setBonusType] = useState<'bonus' | 'balance'>('bonus')
  const [selectedBonusUser, setSelectedBonusUser] = useState<any>(null)
  const [bonusSearchTerm, setBonusSearchTerm] = useState('')
  const [kycActionId, setKycActionId] = useState<string | null>(null)
  const [adminActionKeys, setAdminActionKeys] = useState<Set<string>>(new Set())
  const adminActionInFlightRef = useRef(new Set<string>())

  const startAdminAction = (key: string) => {
    if (adminActionInFlightRef.current.has(key)) return false
    adminActionInFlightRef.current.add(key)
    setAdminActionKeys(new Set(adminActionInFlightRef.current))
    return true
  }

  const finishAdminAction = (key: string) => {
    adminActionInFlightRef.current.delete(key)
    setAdminActionKeys(new Set(adminActionInFlightRef.current))
  }

  const isAdminActionRunning = (key: string) => adminActionKeys.has(key)

  const normalizeStatus = (status?: string | null) => (status || '').toLowerCase()
  const isStatus = (status: string | null | undefined, expected: string) =>
    normalizeStatus(status) === expected.toLowerCase()
  const openExternalDocument = (url?: string | null) => {
    if (!url) return
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const mapKycRequestsWithUsers = (kycRequests: any[], users: any[]) =>
    kycRequests.map((kyc: any) => {
      const user = users.find((u: any) => u.idnum === kyc.idnum)
      return {
        ...kyc,
        userName: user?.userName || user?.name || 'Unknown User',
        userEmail: user?.email || ''
      }
    })

  // Set active tab based on route
  useEffect(() => {
    const path = location.pathname
    if (path.includes('users-management')) setActiveTab('users')
    else if (path.includes('transactions')) setActiveTab('withdrawals')
    else if (path.includes('deposits')) setActiveTab('deposits') // Added routing for deposits
    else if (path.includes('investment-plans')) setActiveTab('investments')
    else if (path.includes('loans-management')) setActiveTab('loans')
    else if (path.includes('system-settings')) setActiveTab('settings')
    else setActiveTab('overview')
  }, [location.pathname])

  // Fallback loading timeout - ensure loading doesn't hang forever
  useEffect(() => {
    const loadingTimeout = setTimeout(() => {
      if (loading) {
        console.warn('AdminDashboard loading timeout reached, forcing load completion')
        setLoading(false)
      }
    }, 15000) // 15 second timeout

    return () => clearTimeout(loadingTimeout)
  }, [loading])

  // Modal Alert System
  const [modalAlert, setModalAlert] = useState<{
    show: boolean
    type: 'success' | 'error' | 'warning' | 'info'
    title: string
    message: string
  }>({ show: false, type: 'info', title: '', message: '' })

  // Confirmation Modal System
  const [confirmModal, setConfirmModal] = useState<{
    show: boolean
    title: string
    message: string
    confirmText: string
    cancelText: string
    onConfirm: () => void
    onCancel?: () => void
  }>({
    show: false,
    title: '',
    message: '',
    confirmText: 'Confirm',
    cancelText: 'Cancel',
    onConfirm: () => {},
    onCancel: () => {}
  })

  const showAlert = (type: 'success' | 'error' | 'warning' | 'info', title: string, message: string) => {
    setModalAlert({ show: true, type, title, message })
  }

  const closeAlert = () => {
    setModalAlert({ show: false, type: 'info', title: '', message: '' })
  }

  const showConfirm = (
    title: string,
    message: string,
    onConfirm: () => void,
    onCancel?: () => void,
    confirmText = 'Confirm',
    cancelText = 'Cancel'
  ) => {
    setConfirmModal({
      show: true,
      title,
      message,
      confirmText,
      cancelText,
      onConfirm,
      onCancel
    })
  }

  const closeConfirm = () => {
    setConfirmModal({
      show: false,
      title: '',
      message: '',
      confirmText: 'Confirm',
      cancelText: 'Cancel',
      onConfirm: () => {},
      onCancel: () => {}
    })
  }

  useEffect(() => {
    const initAdminDashboard = async () => {
      try {
        // Check if admin is authenticated
        const adminStr = localStorage.getItem('adminData') || sessionStorage.getItem('adminData')
        const activeUserStr = localStorage.getItem('activeUser') || sessionStorage.getItem('activeUser')

        if (!adminStr && !activeUserStr) {
          navigate('/admin/login')
          return
        }

        const userData = JSON.parse(adminStr || activeUserStr || '{}')

        // Check if user has admin or superadmin role
        if (userData.role !== 'admin' && userData.role !== 'superadmin') {
          // Redirect non-admins to admin login with error message
          navigate('/admin/login')
          return
        }

        // Verify admin session is still valid
        const adminSession = localStorage.getItem('adminSession')
        if (adminSession) {
          const session = JSON.parse(adminSession)
          if (session.expiresAt && session.expiresAt < Date.now()) {
            // Session expired, clear and redirect
            localStorage.removeItem('adminSession')
            localStorage.removeItem('activeUser')
            navigate('/admin/login')
            return
          }
        }

        setCurrentAdmin(userData)

        // Initialize email service

        // Fetch all data for admin with timeout
        const fetchWithTimeout = (promise: Promise<any>, timeoutMs: number = 10000) => {
          return Promise.race([
            promise,
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Request timeout')), timeoutMs)
            )
          ])
        }

        try {
          console.log('🔄 Fetching admin data from database...')
          const [users, investments, withdrawals, kycRequests, loans, deposits] = await Promise.all([
            fetchWithTimeout(supabaseDb.getAllUsers()),
            fetchWithTimeout(supabaseDb.getAllInvestments()),
            fetchWithTimeout(supabaseDb.getAllWithdrawals()),
            fetchWithTimeout(supabaseDb.getAllKycRequests()),
            fetchWithTimeout(supabaseDb.getAllLoans()),
            fetchWithTimeout(supabaseDb.getAllDeposits()),
          ])

          console.log('✅ Database calls successful:', {
            users: users?.length || 0,
            investments: investments?.length || 0,
            withdrawals: withdrawals?.length || 0,
            kycRequests: kycRequests?.length || 0,
            loans: loans?.length || 0,
            deposits: deposits?.length || 0
          })

          // Join investments with user data
          const investmentsWithUsers = investments.map((investment: any) => {
            const user = users.find((u: any) => u.idnum === investment.idnum)
            return {
              ...investment,
              userName: user?.userName || user?.name || 'Unknown User',
              userEmail: user?.email || ''
            }
          })

          // Join withdrawals with user data
          const withdrawalsWithUsers = withdrawals.map((withdrawal: any) => {
            const user = users.find((u: any) => u.idnum === withdrawal.idnum)
            return {
              ...withdrawal,
              userName: user?.userName || user?.name || 'Unknown User',
              userEmail: user?.email || ''
            }
          })

          // Join KYC requests with user data
          const kycWithUsers = mapKycRequestsWithUsers(kycRequests, users)

          // Join loans with user data
          const loansWithUsers = loans.map((loan: any) => {
            const user = users.find((u: any) => u.idnum === loan.idnum)
            return {
              ...loan,
              userName: user?.userName || user?.name || 'Unknown User',
              userEmail: user?.email || ''
            }
          })

          // Join deposits with user data
          const depositsWithUsers = (deposits || []).map((deposit: any) => {
             const user = users.find((u: any) => u.idnum === deposit.idnum)
             return {
               ...deposit,
               userName: user?.userName || user?.name || 'Unknown User',
               userEmail: user?.email || ''
             }
          })

            // Exclude current admin from the users list to prevent admins from seeing or editing themselves
          const filteredUsers = users.filter((u: any) => u.idnum !== userData.idnum)
          setAllUsers(filteredUsers)
          setAllInvestments(investmentsWithUsers)
          setAllWithdrawals(withdrawalsWithUsers)
          setAllKycRequests(kycWithUsers)
          setAllLoans(loansWithUsers)
          setAllDeposits(depositsWithUsers)

          // Set up Supabase Realtime subscriptions for live updates
          try {
            const investmentsSubscription = supabaseRealtime.subscribeToInvestments(async (payload) => {
            console.log('🔄 Investment change detected:', payload)
            try {
              // Refresh investments data
              const updatedInvestments = await supabaseDb.getAllInvestments()
              const updatedUsers = await supabaseDb.getAllUsers()
              const updatedInvestmentsWithUsers = updatedInvestments.map(investment => {
                const user = updatedUsers.find(u => u.idnum === investment.idnum)
                return {
                  ...investment,
                  userName: user?.userName || user?.name || 'Unknown User',
                  userEmail: user?.email || ''
                }
              })
              setAllInvestments(updatedInvestmentsWithUsers)
            } catch (error) {
              console.error('Failed to refresh investments:', error)
            }
          })

          const withdrawalsSubscription = supabaseRealtime.subscribeToWithdrawals(async (payload) => {
            console.log('🔄 Withdrawal change detected:', payload)
            try {
              const updatedWithdrawals = await supabaseDb.getAllWithdrawals()
              const updatedUsers = await supabaseDb.getAllUsers()
              const updatedWithdrawalsWithUsers = updatedWithdrawals.map(withdrawal => {
                const user = updatedUsers.find(u => u.idnum === withdrawal.idnum)
                return {
                  ...withdrawal,
                  userName: user?.userName || user?.name || 'Unknown User',
                  userEmail: user?.email || ''
                }
              })
              setAllWithdrawals(updatedWithdrawalsWithUsers)
            } catch (error) {
              console.error('Failed to refresh withdrawals:', error)
            }
          })

          const usersSubscription = supabaseRealtime.subscribeToUsers(async (payload) => {
            console.log('🔄 User change detected:', payload)
            try {
              const updatedUsers = await supabaseDb.getAllUsers()
              setAllUsers(updatedUsers)
            } catch (error) {
              console.error('Failed to refresh users:', error)
            }
          })

          const loansSubscription = supabaseRealtime.subscribeToLoans(async (payload) => {
            console.log('🔄 Loan change detected:', payload)
            try {
              const updatedLoans = await supabaseDb.getAllLoans()
              const updatedUsers = await supabaseDb.getAllUsers()
              const updatedLoansWithUsers = updatedLoans.map(loan => {
                const user = updatedUsers.find(u => u.idnum === loan.idnum)
                return {
                  ...loan,
                  userName: user?.userName || user?.name || 'Unknown User',
                  userEmail: user?.email || ''
                }
              })
              setAllLoans(updatedLoansWithUsers)
            } catch (error) {
              console.error('Failed to refresh loans:', error)
            }
          })

          const kycSubscription = supabaseRealtime.subscribeToKyc(async (payload) => {
            console.log('🔄 KYC change detected:', payload)
            try {
              const updatedKyc = await supabaseDb.getAllKycRequests()
              const updatedUsers = await supabaseDb.getAllUsers()
              const updatedKycWithUsers = mapKycRequestsWithUsers(updatedKyc, updatedUsers)
              setAllKycRequests(updatedKycWithUsers)
            } catch (error) {
              console.error('Failed to refresh KYC requests:', error)
            }
          })

          // Cleanup subscriptions on unmount
          return () => {
            investmentsSubscription.unsubscribe()
            withdrawalsSubscription.unsubscribe()
            usersSubscription.unsubscribe()
            loansSubscription.unsubscribe()
            kycSubscription.unsubscribe()
          }
          } catch (error) {
            console.error('❌ Failed to set up real-time subscriptions:', error)
            showAlert('error', 'Subscription Error', 'Failed to set up real-time updates. Some data may not update automatically.')
          }
        } catch (error) {
          console.error('❌ Failed to fetch admin data from database:', error)
          showAlert('error', 'Database Error', 'Failed to load admin data. Please check your database connection.')
          // Don't set mock data - show empty state instead
          setAllUsers([])
          setAllInvestments([])
          setAllWithdrawals([])
          setAllKycRequests([])
          setAllLoans([])
        }
      } catch (error) {
        console.error('Error parsing admin data:', error)
        navigate('/login')
        return
      } finally {
        // Always set loading to false, even if there are errors
        setLoading(false)
      }
    }

    initAdminDashboard()
  }, [navigate])

  // Auto-refresh tables every 20 seconds
  useEffect(() => {
    let refreshInterval: ReturnType<typeof setInterval> | null = null

    const refreshAllData = async () => {
      try {
        const [users, investments, withdrawals, kycRequests, loans, deposits] = await Promise.all([
          supabaseDb.getAllUsers(),
          supabaseDb.getAllInvestments(),
          supabaseDb.getAllWithdrawals(),
          supabaseDb.getAllKycRequests(),
          supabaseDb.getAllLoans(),
          supabaseDb.getAllDeposits(),
        ])

        // Filter out current admin from users
        const adminStr = localStorage.getItem('adminData') || sessionStorage.getItem('adminData')
        const activeUserStr = localStorage.getItem('activeUser') || sessionStorage.getItem('activeUser')
        const adminData = JSON.parse(adminStr || activeUserStr || '{}')
        const filteredUsers = users.filter((u: any) => u.idnum !== adminData.idnum)

        // Join with user data
        const investmentsWithUsers = investments.map((investment: any) => {
          const user = users.find((u: any) => u.idnum === investment.idnum)
          return {
            ...investment,
            userName: user?.userName || user?.name || 'Unknown User',
            userEmail: user?.email || ''
          }
        })

        const withdrawalsWithUsers = withdrawals.map((withdrawal: any) => {
          const user = users.find((u: any) => u.idnum === withdrawal.idnum)
          return {
            ...withdrawal,
            userName: user?.userName || user?.name || 'Unknown User',
            userEmail: user?.email || ''
          }
        })

        const kycWithUsers = mapKycRequestsWithUsers(kycRequests, users)

        const loansWithUsers = loans.map((loan: any) => {
          const user = users.find((u: any) => u.idnum === loan.idnum)
          return {
            ...loan,
            userName: user?.userName || user?.name || 'Unknown User',
            userEmail: user?.email || ''
          }
        })

        const depositsWithUsers = (deposits || []).map((deposit: any) => {
          const user = users.find((u: any) => u.idnum === deposit.idnum)
          return {
            ...deposit,
            userName: user?.userName || user?.name || 'Unknown User',
            userEmail: user?.email || ''
          }
        })

        setAllUsers(filteredUsers)
        setAllInvestments(investmentsWithUsers)
        setAllWithdrawals(withdrawalsWithUsers)
        setAllKycRequests(kycWithUsers)
        setAllLoans(loansWithUsers)
        setAllDeposits(depositsWithUsers)
      } catch (error) {
        console.warn('Auto-refresh failed:', error)
      }
    }

    // Start auto-refresh interval (5 seconds)
    refreshInterval = setInterval(refreshAllData, 5000)

    return () => {
      if (refreshInterval) clearInterval(refreshInterval)
    }
  }, [])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const handleApproveInvestment = async (investmentId: string) => {
    const actionKey = `approve-investment:${investmentId}`
    if (!startAdminAction(actionKey)) return

    try {
      console.log('Approving investment:', investmentId)
      
      // Get investment details first to access capital amount
      const investment = allInvestments.find(inv => inv.id === investmentId)
      if (!investment) {
        console.error('Investment not found:', investmentId)
        showAlert('error', t('alerts.investmentNotFoundTitle'), t('alerts.investmentNotFoundMessage'))
        return
      }

      // Backend-driven approval (handles email + notification server-side)
      const approved = await supabaseDb.approveInvestment(investmentId)

      // Add invested capital to user's balance
      const currentUser = allUsers.find(u => u.idnum === investment.idnum)
      if (currentUser) {
        const newBalance = (currentUser.balance || 0) + (investment.capital || 0)
        await supabaseDb.updateUser(currentUser.idnum, { balance: newBalance })

        // Update local state for users
        setAllUsers(prev => 
          prev.map(user => user.idnum === investment.idnum ? { 
            ...user, 
            balance: newBalance 
          } : user)
        )
      } else {
        console.warn('User not found for investment:', investment.idnum)
      }

      // Update local state for investments with server values
      setAllInvestments(prev => 
        prev.map(inv => inv.id === investmentId ? { 
          ...inv, 
          status: approved.status || 'Active', 
          authStatus: approved.authStatus || 'approved',
          startDate: approved.startDate || inv.startDate
        } : inv)
      )

      showAlert('success', t('alerts.investmentApprovedTitle'), t('alerts.investmentApprovedMessage'))
    } catch (error) {
      console.error('Error approving investment:', error)
      showAlert('error', t('alerts.approvalFailedTitle'), t('alerts.approvalFailedMessage'))
    } finally {
      finishAdminAction(actionKey)
    }
  }

  const handleRejectInvestment = async (investmentId: string) => {
    const actionKey = `reject-investment:${investmentId}`
    if (!startAdminAction(actionKey)) return

    try {
      const investment = allInvestments.find(inv => inv.id === investmentId)

      // Update status in database
      await supabaseDb.updateInvestment(investmentId, { 
        status: 'Rejected',
        authStatus: 'rejected'
      })

      // Update local state
      setAllInvestments(prev => 
        prev.map(inv => inv.id === investmentId ? { ...inv, status: 'Rejected', authStatus: 'rejected' } : inv)
      )

      if (investment) {
        if (investment.idnum) {
          await supabaseDb.createNotification({
            idnum: investment.idnum,
            title: 'Investment Rejected',
            message: `Your investment request of $${Number(investment.capital || 0).toLocaleString()} for ${investment.plan || 'your selected plan'} has been rejected.`,
            type: 'error',
            read: false
          })
        }

        if (investment.userEmail) {
          await sendInvestmentNotification(
            investment.userEmail,
            investment.userName || 'User',
            'rejected',
            investment.capital || 0,
            investment.plan || 'Investment Plan'
          )
        }
      }

      showAlert('error', t('alerts.investmentRejectedTitle'), t('alerts.investmentRejectedMessage'))
    } catch (error) {
      console.error('Error rejecting investment:', error)
      showAlert('error', t('alerts.rejectionFailedTitle'), t('alerts.rejectionFailedMessage'))
    } finally {
      finishAdminAction(actionKey)
    }
  }

  const handleViewPaymentProof = (paymentProofUrl: string) => {
    if (paymentProofUrl) {
      // Get the public URL for the payment proof
      const { data } = (supabase as any).storage
        .from('payment-proofs')
        .getPublicUrl(paymentProofUrl)
      
      if (data?.publicUrl) {
        window.open(data.publicUrl, '_blank')
      }
    }
  }

  const handleViewTransaction = (transactionHash: string, paymentOption: string) => {
    if (transactionHash && paymentOption) {
      let explorerUrl = ''
      
      // Determine blockchain explorer based on payment option
      if (paymentOption.includes('USDT-ERC20') || paymentOption.includes('Ethereum')) {
        explorerUrl = `https://etherscan.io/tx/${transactionHash}`
      } else if (paymentOption.includes('USDT-BEP20') || paymentOption.includes('Binance')) {
        explorerUrl = `https://bscscan.com/tx/${transactionHash}`
      } else if (paymentOption.includes('USDT-TRC20') || paymentOption.includes('Tron')) {
        explorerUrl = `https://tronscan.org/#/transaction/${transactionHash}`
      } else if (paymentOption.includes('Bitcoin')) {
        explorerUrl = `https://blockchain.com/btc/tx/${transactionHash}`
      }
      
      if (explorerUrl) {
        window.open(explorerUrl, '_blank')
      }
    }
  }

  const handleApproveWithdrawal = async (withdrawalId: number) => {
    const actionKey = `approve-withdrawal:${withdrawalId}`
    if (!startAdminAction(actionKey)) return

    try {
      // Backend-driven approval (handles email + notification server-side)
      const approved = await supabaseDb.approveWithdrawal(withdrawalId.toString())

      // Update local state for withdrawals
      setAllWithdrawals(prev => 
        prev.map(w => w.id === withdrawalId ? { 
          ...w, 
          status: approved.status || 'Approved',
          authStatus: approved.authStatus || 'approved'
        } : w)
      )

      showAlert('success', t('alerts.withdrawalApprovedTitle'), t('alerts.withdrawalApprovedMessage'))
    } catch (error) {
      console.error('Error approving withdrawal:', error)
      showAlert('error', t('alerts.approvalFailedTitle'), t('alerts.approvalErrorMessage'))
    } finally {
      finishAdminAction(actionKey)
    }
  }

  const handleRejectWithdrawal = async (withdrawalId: number) => {
    const actionKey = `reject-withdrawal:${withdrawalId}`
    if (!startAdminAction(actionKey)) return

    try {
      // Update status in database
      await supabaseDb.updateWithdrawal(withdrawalId.toString(), { 
        status: 'Rejected'
      })

      // Update local state
      setAllWithdrawals(prev => 
        prev.map(w => w.id === withdrawalId ? { ...w, status: 'Rejected' } : w)
      )

      // Send email notification
      const withdrawal = allWithdrawals.find(w => w.id === withdrawalId)
      if (withdrawal) {
        await sendWithdrawalNotification(
          withdrawal.userEmail,
          withdrawal.userName,
          'rejected',
          withdrawal.amount || 0,
          withdrawal.method || 'Bank Transfer'
        )

        // Create in-app notification
        await supabaseDb.createNotification({
            idnum: withdrawal.idnum,
            title: 'Withdrawal Rejected',
            message: `Your withdrawal of $${(withdrawal.amount || 0).toLocaleString()} has been rejected.`,
            type: 'error',
            read: false
        })

        // Refund the amount to user balance if rejected
        if (withdrawal.idnum && withdrawal.amount) {
           const user = allUsers.find(u => u.idnum === withdrawal.idnum);
           if (user) {
             await supabaseDb.updateUser(user.idnum, {
               balance: (user.balance || 0) + (withdrawal.amount || 0)
             });
           }
        }
      }

      showAlert('error', t('alerts.withdrawalRejectedTitle'), t('alerts.withdrawalRejectedMessage'))
    } catch (error) {
      console.error('Error rejecting withdrawal:', error)
      showAlert('error', t('alerts.rejectionFailedTitle'), t('alerts.rejectionFailedMessage'))
    } finally {
      finishAdminAction(actionKey)
    }
  }

  const handleApproveDeposit = async (depositId: string, userId: string, amount: number) => {
    const actionKey = `approve-deposit:${depositId}`
    if (!startAdminAction(actionKey)) return

    try {
      console.log('\n' + '='.repeat(70));
      console.log('🔄 DEPOSIT APPROVAL FLOW STARTED');
      console.log('='.repeat(70));
      console.log('Step 1: Update deposit status');
      
      // 1. Update deposit status
      await supabaseDb.updateDeposit(depositId, { status: 'Approved' })
      console.log('✅ Deposit status updated to Approved');

      // 2. Fetch current user to get balance
      console.log('Step 2: Fetch user data');
      const users = await supabaseDb.getAllUsers();
      const user = users.find(u => u.id === userId || u.idnum === userId);
      
      if (!user) throw new Error('User not found')
      console.log('✅ User found:', { email: user.email, name: user.name });

      // 3. Update user balance
      console.log('Step 3: Update user balance');
      const newBalance = (user.balance || 0) + amount
      if (user.idnum) {
         await supabaseDb.updateUser(user.idnum, { balance: newBalance })
         console.log(`✅ User balance updated: $${newBalance}`);
      }

      // 4. Update local state
      console.log('Step 4: Update UI state');
      setAllDeposits(prev => 
        prev.map(d => d.id === depositId ? { ...d, status: 'Approved' } : d)
      )
      
      // Update users list
      setAllUsers(prev => prev.map(u => 
        (u.id === userId || u.idnum === userId) ? { ...u, balance: newBalance } : u
      ))
      console.log('✅ UI state updated');

      // 5. Notify User
      console.log('Step 5: Create in-app notification');
      if (user.idnum) {
        await supabaseDb.createNotification({
          idnum: user.idnum,
          title: 'Deposit Approved',
          message: `Your deposit of $${amount.toLocaleString()} has been approved and credited to your balance.`,
          type: 'success',
          read: false
        })
        console.log('✅ In-app notification created');

        // Send Email via Server Endpoint
        console.log('Step 6: Send approval email via server endpoint');
        const deposit = allDeposits.find(d => d.id === depositId);
        if (deposit && user.email) {
          try {
            console.log(`📧 Calling /api/deposits/approve for: ${user.email}`);
            const response = await fetch('/api/deposits/approve', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                depositId: depositId,
                userId: user.idnum,
                amount: amount,
                method: deposit.method || 'Crypto',
                transactionHash: deposit.transaction_hash,
                userEmail: user.email,
                userName: user.userName || user.name || 'User'
              })
            });
            
            if (response.ok) {
              console.log('✅ Deposit approval email queued via server');
            } else {
              const error = await response.json();
              console.warn('⚠️  Server returned error:', error);
            }
          } catch (emailError) {
            console.error('❌ Error calling email endpoint:', emailError);
            // Continue - notification already created
          }
        }
      }

      console.log('='.repeat(70));
      console.log('✅ DEPOSIT APPROVAL COMPLETED SUCCESSFULLY');
      console.log('='.repeat(70) + '\n');
      
      showAlert('success', 'Deposit Approved', `Deposit of $${amount.toLocaleString()} has been approved and added to user balance.`)
    } catch (error) {
      console.error('='.repeat(70));
      console.error('❌ DEPOSIT APPROVAL FAILED:', error)
      console.error('='.repeat(70) + '\n');
      showAlert('error', 'Error', 'Failed to approve deposit')
    } finally {
      finishAdminAction(actionKey)
    }
  }

  const handleRejectDeposit = async (depositId: string) => {
    const actionKey = `reject-deposit:${depositId}`
    if (!startAdminAction(actionKey)) return

    try {
      await supabaseDb.updateDeposit(depositId, { status: 'Rejected' })

      setAllDeposits(prev => 
        prev.map(d => d.id === depositId ? { ...d, status: 'Rejected' } : d)
      )

      // Notify User
      const deposit = allDeposits.find(d => d.id === depositId);
      if (deposit) {
          const user = allUsers.find(u => u.id === deposit.user_id || u.idnum === deposit.idnum);
          if (user?.idnum) {
              await supabaseDb.createNotification({
                  idnum: user.idnum,
                  title: 'Deposit Rejected',
                  message: 'Your deposit request has been rejected.',
                  type: 'error',
                  read: false
              })
          }
          
          if (user) {
             // Send Email
             if (user.email) {
               try {
                 console.log('📧 Attempting to send deposit rejection email to:', user.email);
                 await sendDepositNotification(
                    user.email,
                    user.userName || user.name || 'User',
                    'rejected',
                    deposit.amount,
                    deposit.method || 'Crypto'
                 );
                 console.log('✅ Deposit rejection email sent to:', user.email);
               } catch (emailError) {
                 console.error('❌ Error sending deposit rejection email:', emailError);
                 // Continue - notification already created
               }
             }
          }
      }

      showAlert('error', 'Deposit Rejected', 'The deposit request has been rejected.')
    } catch (error) {
      console.error('Error rejecting deposit:', error)
      showAlert('error', 'Error', 'Failed to reject deposit')
    } finally {
      finishAdminAction(actionKey)
    }
  }

  const handleDeleteUser = async (userId: string) => {
    try {
      await supabaseDb.deleteUser(userId)
      setAllUsers(prev => prev.filter(u => u.idnum !== userId))
      setShowUserModal(false)
      showAlert('success', 'User Deleted', 'User has been removed from the database.')
    } catch (error) {
      console.error('Error deleting user:', error)
      showAlert('error', 'Error', 'Failed to delete user.')
    }
  }

  const handleApproveKyc = async (kycId: string) => {
    const actionKey = `approve-kyc:${kycId}`
    if (!startAdminAction(actionKey)) return

    try {
      setKycActionId(kycId)
      const kyc = allKycRequests.find(k => k.id === kycId)
      if (kyc) {
        // Send email notification
        await sendKYCNotification(
          kyc.userEmail,
          kyc.userName,
          'approved'
        )

        // Notification
        if (kyc.idnum) {
            await supabaseDb.createNotification({
              idnum: kyc.idnum,
              title: 'KYC Approved',
              message: 'Your identity verification has been approved.',
              type: 'success',
              read: false
            })

            // Update user status
            await supabaseDb.updateUser(kyc.idnum, { authStatus: 'approved' })
        }
      }
      await supabaseDb.updateKycStatus(kycId, 'approved')
      setAllKycRequests(prev => 
        prev.map(kyc => kyc.id === kycId ? { ...kyc, status: 'approved', reviewedAt: new Date().toISOString() } : kyc)
      )
      showAlert('success', t('alerts.kycApprovedAdminTitle'), t('alerts.kycApprovedAdminMessage'))
    } catch (error) {
      console.error('Error approving KYC:', error)
      showAlert('error', t('alerts.kycApprovedError'), t('alerts.kycApprovedError'))
    } finally {
      setKycActionId(null)
      finishAdminAction(actionKey)
    }
  }

  const handleRejectKyc = async (kycId: string, rejectionReason?: string) => {
    const actionKey = `reject-kyc:${kycId}`
    if (!startAdminAction(actionKey)) return

    try {
      setKycActionId(kycId)
      const kyc = allKycRequests.find(k => k.id === kycId)
      if (kyc) {
        // Send email notification
        await sendKYCNotification(
          kyc.userEmail,
          kyc.userName,
          'rejected'
        )

        // Notification
        if (kyc.idnum) {
            await supabaseDb.createNotification({
              idnum: kyc.idnum,
              title: 'KYC Rejected',
              message: `Your identity verification failed.${rejectionReason ? ' Reason: ' + rejectionReason : ''}`,
              type: 'error',
              read: false
            })

            // Update user status
            await supabaseDb.updateUser(kyc.idnum, { authStatus: 'rejected' })
        }
      }
      await supabaseDb.updateKycStatus(kycId, 'rejected', rejectionReason)
      setAllKycRequests(prev => 
        prev.map(kyc => kyc.id === kycId ? { ...kyc, status: 'rejected', reviewedAt: new Date().toISOString() } : kyc)
      )
      showAlert('error', t('alerts.kycRejectedTitle'), t('alerts.kycRejectedMessage'))
    } catch (error) {
      console.error('Error rejecting KYC:', error)
      showAlert('error', t('alerts.kycRejectedError'), t('alerts.kycRejectedError'))
    } finally {
      setKycActionId(null)
      finishAdminAction(actionKey)
    }
  }

  const handleViewUser = (user: any) => {
    setSelectedUser(user)
    setNewBalance(user.balance?.toString() || '0')
    setBalanceUpdateReason('')
    setShowUserModal(true)
  }

  const handleUpdateUserBalance = async () => {
    if (!selectedUser || !newBalance) return
    const actionKey = `update-balance:${selectedUser.idnum || selectedUser.id || 'selected'}`
    if (!startAdminAction(actionKey)) return
    
    if (!balanceUpdateReason.trim()) {
        showAlert('warning', 'Reason Required', 'Please provide a reason for the balance update.')
        finishAdminAction(actionKey)
        return
    }

    const balance = parseFloat(newBalance)
    if (isNaN(balance) || balance < 0) {
      showAlert('error', t('alerts.titleInvalidAmount'), t('alerts.invalidAmountError'))
      finishAdminAction(actionKey)
      return
    }

    try {
        // 1. Update Database
        if (selectedUser.idnum) {
            await supabaseDb.updateUser(selectedUser.idnum, { balance })
        }

        // 2. Notification with Reason
        if (selectedUser.idnum) {
            await supabaseDb.createNotification({
                idnum: selectedUser.idnum,
                title: 'Balance Updated',
                message: `Your balance has been updated to $${balance.toLocaleString()} by admin. Reason: ${balanceUpdateReason}`,
                type: 'info',
                read: false
            })
        }

        // 3. Send Email
        await sendBalanceUpdateNotification(
          selectedUser.email,
          selectedUser.userName || selectedUser.name,
          balance,
          selectedUser.balance || 0
        )

        // 4. Update Local State
        const updatedUser = { ...selectedUser, balance }
        setAllUsers(prev => prev.map(u => u.idnum === selectedUser.idnum ? updatedUser : u))
        setSelectedUser(updatedUser)

        showAlert('success', t('alerts.balanceUpdatedTitle'), t('alerts.balanceUpdatedMessage', { balance: balance.toLocaleString() }))
    } catch (error) {
        console.error('Failed to update balance:', error)
        showAlert('error', 'Update Failed', 'Could not update user balance.')
    } finally {
        finishAdminAction(actionKey)
    }
  }

  // Calculate statistics
  const totalUsers = allUsers.length
  const totalInvestments = allInvestments.reduce((sum, inv) => sum + (inv.capital || 0), 0)
  const pendingInvestments = allInvestments.filter(inv => isStatus(inv.status, 'pending')).length
  const pendingWithdrawals = allWithdrawals.filter(w => isStatus(w.status, 'pending')).length
  const totalWithdrawals = allWithdrawals.reduce((sum, w) => sum + (w.amount || 0), 0)
  const pendingKyc = allKycRequests.filter(k => isStatus(k.status, 'pending')).length

  if (loading) {
    return (
      <div className="dashboard-container">
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          minHeight: '100vh',
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)'
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ 
              width: '60px', 
              height: '60px', 
              border: '4px solid rgba(240,185,11,0.2)',
              borderTop: '4px solid #f0b90b',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 1rem'
            }}></div>
            <h2 style={{ color: '#f8fafc', fontSize: '1.25rem' }}>Loading Admin Dashboard...</h2>
          </div>
        </div>
      </div>
    )
  }

  // Get current page title based on active tab
  const getPageTitle = () => {
    switch(activeTab) {
      case 'overview': return 'Dashboard Overview';
      case 'users': return 'User Management';
      case 'investments': return 'Investments';
      case 'withdrawals': return 'Withdrawals';
      case 'kyc': return 'KYC Requests';
      case 'loans': return 'Loan Requests';
      case 'bonus': return 'Bonus Management';
      case 'settings': return 'System Settings';
      default: return 'Admin Panel';
    }
  };

  // Loan approval/rejection handlers
  const handleApproveLoan = async (loan: any) => {
    const actionKey = `approve-loan:${loan.id}`
    if (!startAdminAction(actionKey)) return

    try {
      // Send email notification
      await sendLoanNotification(
        loan.userEmail,
        loan.userName,
        'approved',
        loan.amount || 0,
        loan.duration || 30
      )
      await supabaseDb.updateLoan(loan.id, { status: 'approved', authStatus: 'approved' })
      setAllLoans(prev => prev.map(l => l.id === loan.id ? { ...l, status: 'approved', authStatus: 'approved' } : l))
      showAlert('success', t('alerts.loanApprovedTitle'), t('alerts.loanApprovedMessage', { amount: loan.amount?.toLocaleString() }))
    } catch (error) {
      console.error('Error approving loan:', error)
      showAlert('error', t('alerts.approvalFailedTitle'), t('alerts.approvalFailedMessage'))
    } finally {
      finishAdminAction(actionKey)
    }
  }

  const handleRejectLoan = async (loan: any) => {
    const actionKey = `reject-loan:${loan.id}`
    if (!startAdminAction(actionKey)) return

    try {
      // Send email notification
      await sendLoanNotification(
        loan.userEmail,
        loan.userName,
        'rejected',
        loan.amount || 0,
        loan.duration || 30
      )
      await supabaseDb.updateLoan(loan.id, { status: 'rejected', authStatus: 'rejected' })
      setAllLoans(prev => prev.map(l => l.id === loan.id ? { ...l, status: 'rejected', authStatus: 'rejected' } : l))
      showAlert('success', t('alerts.loanRejectedTitle'), t('alerts.loanRejectedMessage'))
    } catch (error) {
      console.error('Error rejecting loan:', error)
      showAlert('error', t('alerts.rejectionFailedTitle'), t('alerts.rejectionFailedMessage'))
    } finally {
      finishAdminAction(actionKey)
    }
  }

  const handleAddBonusToUser = (user: any) => {
    setSelectedBonusUser(user)
    setShowAddBonusModal(true)
  }

  const handleConfirmAddBonus = async () => {
    if (!selectedBonusUser || !bonusAmount || parseFloat(bonusAmount) <= 0) {
      showAlert('error', t('alerts.titleInvalidAmount'), t('alerts.invalidAmountError'))
      return
    }

    const actionKey = `add-bonus:${selectedBonusUser.idnum || selectedBonusUser.id}`
    if (!startAdminAction(actionKey)) return

    try {
      const amount = parseFloat(bonusAmount)
      let updateData: any = {}
      let successMessage = ''

      if (bonusType === 'bonus') {
        const currentBonus = selectedBonusUser.bonus || 0
        const newBonusAmount = currentBonus + amount
        updateData.bonus = newBonusAmount

        // Update local state
        setAllUsers(prev => prev.map(u => 
          u.idnum === selectedBonusUser.idnum 
            ? { ...u, bonus: newBonusAmount }
            : u
        ))

        successMessage = t('alerts.bonusAddedMessage', { bonus: amount.toLocaleString(), name: selectedBonusUser.name || selectedBonusUser.email })
      } else {
        const currentBalance = selectedBonusUser.balance || 0
        const newBalanceAmount = currentBalance + amount
        updateData.balance = newBalanceAmount

        // Update local state
        setAllUsers(prev => prev.map(u => 
          u.idnum === selectedBonusUser.idnum 
            ? { ...u, balance: newBalanceAmount }
            : u
        ))

        successMessage = t('alerts.balanceAddedMessage', { defaultValue: 'Successfully added ${{amount}} to available balance for {{name}}', amount: amount.toLocaleString(), name: selectedBonusUser.name || selectedBonusUser.email })
      }

      await supabaseDb.updateUser(selectedBonusUser.idnum, updateData)

      // Send notification
      await sendBalanceUpdateNotification(
        selectedBonusUser.email,
        selectedBonusUser.name || selectedBonusUser.userName,
        bonusType === 'bonus' ? (selectedBonusUser.bonus || 0) + amount : selectedBonusUser.balance || 0,
        bonusType === 'bonus' ? selectedBonusUser.bonus || 0 : selectedBonusUser.balance || 0
      )

      showAlert('success', t('alerts.amountAddedTitle', { defaultValue: 'Amount Added' }), successMessage)
      setShowAddBonusModal(false)
      setSelectedBonusUser(null)
      setBonusAmount('')
      setBonusReason('')
      setBonusType('bonus')
    } catch (error) {
      console.error('Error adding amount:', error)
      showAlert('error', t('alerts.addAmountError', { defaultValue: 'Addition Failed' }), t('alerts.addAmountErrorMessage', { defaultValue: 'Failed to add amount. Please try again.' }))
    } finally {
      finishAdminAction(actionKey)
    }
  }

  const handleRemoveBonusFromUser = async (user: any) => {
    const amount = prompt(`Enter amount to remove from ${user.name || user.email}'s bonus:`)
    if (!amount || parseFloat(amount) <= 0) return

    if (parseFloat(amount) > (user.bonus || 0)) {
      showAlert('error', t('alerts.titleInvalidAmount'), t('alerts.cannotRemoveMoreThanCurrentBonus'))
      return
    }

    try {
      const newBonusAmount = (user.bonus || 0) - parseFloat(amount)

      await supabaseDb.updateUser(user.idnum, { 
        bonus: newBonusAmount 
      })

      // Update local state
      setAllUsers(prev => prev.map(u => 
        u.idnum === user.idnum 
          ? { ...u, bonus: newBonusAmount }
          : u
      ))

      showAlert('success', t('alerts.bonusRemovedTitle'), t('alerts.bonusRemovedMessage', { amount: parseFloat(amount).toLocaleString(), name: user.name || user.email }))
    } catch (error) {
      console.error('Error removing bonus:', error)
      showAlert('error', t('alerts.failedToRemoveBonusTitle'), t('alerts.failedToRemoveBonusMessage'))
    }
  }

  const handleConvertBonusToBalance = async (user: any) => {
    if (!user.bonus || user.bonus <= 0) {
      showAlert('error', t('alerts.noBonusToConvertTitle', { defaultValue: 'No Bonus Available' }), t('alerts.noBonusToConvertMessage', { defaultValue: 'This user has no bonus to convert.' }))
      return
    }

    const confirmConvert = window.confirm(`Convert $${user.bonus.toLocaleString()} bonus to available balance for ${user.name || user.email}?`)
    if (!confirmConvert) return

    try {
      const bonusAmount = user.bonus
      const newBalance = (user.balance || 0) + bonusAmount

      await supabaseDb.updateUser(user.idnum, { 
        balance: newBalance,
        bonus: 0
      })

      // Update local state
      setAllUsers(prev => prev.map(u => 
        u.idnum === user.idnum 
          ? { ...u, balance: newBalance, bonus: 0 }
          : u
      ))

      // Send notification
      await sendBalanceUpdateNotification(
        user.email,
        user.name || user.userName,
        newBalance,
        user.balance || 0
      )

      showAlert('success', t('alerts.bonusConvertedTitle', { defaultValue: 'Bonus Converted' }), t('alerts.bonusConvertedMessage', { defaultValue: 'Successfully converted ${{bonus}} bonus to available balance for {{name}}', bonus: bonusAmount.toLocaleString(), name: user.name || user.email }))
    } catch (error) {
      console.error('Error converting bonus:', error)
      showAlert('error', t('alerts.convertBonusError', { defaultValue: 'Conversion Failed' }), t('alerts.convertBonusErrorMessage', { defaultValue: 'Failed to convert bonus. Please try again.' }))
    }
  }
  const pendingLoans = allLoans.filter(l => l.status === 'pending').length
  const totalLoanAmount = allLoans.filter(l => l.status === 'approved').reduce((sum, l) => sum + (l.amount || 0), 0)

  return (
    <div className="dashboard-container">
      {/* Mobile Header Bar */}
      <div className="mobile-header">
        <button 
          className="mobile-header-btn"
          onClick={() => setShowSidePanel(!showSidePanel)}
          aria-label="Toggle menu"
        >
          <i className="icofont-navigation-menu"></i>
        </button>
        <h1 className="mobile-header-title">{getPageTitle()}</h1>
        <div className="mobile-header-logo">
          <span style={{ color: '#f0b90b', fontWeight: 700 }}>CV</span>
        </div>
      </div>

      {/* Mobile header controls handle sidebar toggle; removed floating button for consistency */}

      {/* Admin Sidebar */}
      <aside className={`dashboard-sidebar ${showSidePanel ? 'show' : ''}`}>
        <div className="sidebar-header">
          <div className="logo-section">
            {/* Admin Avatar */}
            {currentAdmin?.avatar ? (
              <img 
                src={`/images/${currentAdmin.avatar}.svg`} 
                alt="Admin Avatar"
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '12px',
                  objectFit: 'cover',
                  border: '2px solid rgba(240, 185, 11, 0.3)',
                  boxShadow: '0 2px 8px rgba(240, 185, 11, 0.3)'
                }}
                onError={(e) => {
                  // Fallback to emoji if image fails to load
                  const target = e.target as HTMLImageElement;
                  target.style.display = 'none';
                  const fallback = target.nextElementSibling as HTMLElement;
                  if (fallback) fallback.style.display = 'flex';
                }}
              />
            ) : null}
            <div 
              className="logo-icon" 
              style={{ 
                background: 'linear-gradient(135deg, #f0b90b 0%, #f8d12f 100%)',
                width: '48px',
                height: '48px',
                borderRadius: '12px',
                display: currentAdmin?.avatar ? 'none' : 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.5rem',
                color: '#0f172a',
                fontWeight: 700
              }}
            >
              👨‍💼
            </div>
            <div>
              <h1 className="logo-text" style={{ fontSize: '1.25rem', margin: 0 }}>Admin Panel</h1>
              <p style={{ color: '#94a3b8', fontSize: '0.875rem', margin: 0 }}>{currentAdmin?.userName || 'Administrator'}</p>
            </div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <button
            className={`nav-item ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => { setActiveTab('overview'); setShowSidePanel(false); navigate('/admin'); }}
          >
            <i className="icofont-dashboard-web"></i>
            <span>Overview</span>
          </button>
          
          <button
            className={`nav-item ${activeTab === 'deposits' ? 'active' : ''}`}
            onClick={() => { setActiveTab('deposits'); setShowSidePanel(false); navigate('/admin/deposits'); }}
          >
            <i className="icofont-download-alt"></i>
            <span>Deposits</span>
            {allDeposits.filter(d => d.status === 'pending').length > 0 && (
              <span className="badge">{allDeposits.filter(d => d.status === 'pending').length}</span>
            )}
          </button>

          <button
            className={`nav-item ${activeTab === 'users' ? 'active' : ''}`}
            onClick={() => { setActiveTab('users'); setShowSidePanel(false); navigate('/admin/users-management'); }}
          >
            <i className="icofont-users-alt-5"></i>
            <span>Users</span>
            {totalUsers > 0 && (
              <span className="badge">{totalUsers}</span>
            )}
          </button>
          <button
            className={`nav-item ${activeTab === 'investments' ? 'active' : ''}`}
            onClick={() => { setActiveTab('investments'); setShowSidePanel(false); navigate('/admin/investment-plans'); }}
          >
            <i className="icofont-chart-growth"></i>
            <span>Investments</span>
            {pendingInvestments > 0 && (
              <span className="badge">{pendingInvestments}</span>
            )}
          </button>
          <button
            className={`nav-item ${activeTab === 'withdrawals' ? 'active' : ''}`}
            onClick={() => { setActiveTab('withdrawals'); setShowSidePanel(false); navigate('/admin/transactions'); }}
          >
            <i className="icofont-money"></i>
            <span>Withdrawals</span>
            {pendingWithdrawals > 0 && (
              <span className="badge">{pendingWithdrawals}</span>
            )}
          </button>
          <button
            className={`nav-item ${activeTab === 'kyc' ? 'active' : ''}`}
            onClick={() => { setActiveTab('kyc'); setShowSidePanel(false); }}
          >
            <i className="icofont-id-card"></i>
            <span>KYC Requests</span>
            {pendingKyc > 0 && (
              <span className="badge">{pendingKyc}</span>
            )}
          </button>
          <button
            className={`nav-item ${activeTab === 'loans' ? 'active' : ''}`}
            onClick={() => { setActiveTab('loans'); setShowSidePanel(false); navigate('/admin/loans-management'); }}
          >
            <i className="icofont-money-bag"></i>
            <span>Loans</span>
            {pendingLoans > 0 && (
              <span className="badge">{pendingLoans}</span>
            )}
          </button>

          <button
            className={`nav-item ${activeTab === 'bonus' ? 'active' : ''}`}
            onClick={() => { setActiveTab('bonus'); setShowSidePanel(false); }}
          >
            <i className="icofont-gift"></i>
            <span>Bonus Management</span>
          </button>

          {/* Super Admin Only - System Settings */}
          {currentAdmin?.role === 'superadmin' && (
            <button
              className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={() => { setActiveTab('settings'); setShowSidePanel(false); navigate('/admin/system-settings'); }}
              style={{
                marginTop: '1rem',
                background: 'linear-gradient(135deg, rgba(139,92,246,0.15) 0%, rgba(59,130,246,0.15) 100%)',
                border: '1px solid rgba(139,92,246,0.3)'
              }}
            >
              <i className="icofont-gear"></i>
              <span>System Settings</span>
            </button>
          )}
        </nav>

        <div className="sidebar-footer">
          <button className="nav-item" onClick={() => navigate('/') }>
            <i className="icofont-ui-user"></i>
            <span>View Website</span>
          </button>
          <button className="logout-btn" onClick={handleLogout}>
            <i className="icofont-sign-out"></i>
            <span>Log Out</span>
          </button>
        </div>

        {showSidePanel && (
          <button className="sidebar-close" onClick={() => setShowSidePanel(false)}>
            <i className="icofont-close"></i>
          </button>
        )}
      </aside>

      {/* Main Content */}
      <main className="dashboard-main">
        <div className="dashboard-content">{activeTab === 'overview' && (
            <>
              {/* Stats Grid */}
              <div className="stats-grid">
                <div className="stat-card" style={{ 
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
                }}>
                  <div className="stat-icon">
                    <i className="icofont-users-alt-5"></i>
                  </div>
                  <div className="stat-info">
                    <p className="stat-label">Total Users</p>
                    <h3 className="stat-value">{totalUsers}</h3>
                  </div>
                </div>

                <div className="stat-card" style={{ 
                  background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)'
                }}>
                  <div className="stat-icon">
                    <i className="icofont-chart-line"></i>
                  </div>
                  <div className="stat-info">
                    <p className="stat-label">Total Investments</p>
                    <h3 className="stat-value">${totalInvestments.toLocaleString()}</h3>
                  </div>
                </div>

                <div className="stat-card" style={{ 
                  background: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)'
                }}>
                  <div className="stat-icon">
                    <i className="icofont-clock-time"></i>
                  </div>
                  <div className="stat-info">
                    <p className="stat-label">Pending Investments</p>
                    <h3 className="stat-value">{pendingInvestments}</h3>
                  </div>
                </div>

                <div className="stat-card" style={{ 
                  background: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)'
                }}>
                  <div className="stat-icon">
                    <i className="icofont-money-bag"></i>
                  </div>
                  <div className="stat-info">
                    <p className="stat-label">Pending Withdrawals</p>
                    <h3 className="stat-value">{pendingWithdrawals}</h3>
                  </div>
                </div>
              </div>

              {/* Quick Actions */}
              <div style={{ marginTop: '2rem' }}>
                <h3 style={{ color: '#f8fafc', fontSize: '1.25rem', marginBottom: '1rem', fontWeight: 600 }}>
                  <i className="icofont-flash"></i> Quick Actions
                </h3>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: '1rem'
                }}>
                    {/* Deposit quick-action removed for admin */}
                  <button
                    onClick={() => setActiveTab('investments')}
                    style={{
                      padding: '1.5rem',
                      background: 'rgba(240,185,11,0.1)',
                      border: '1px solid rgba(240,185,11,0.3)',
                      borderRadius: '12px',
                      textAlign: 'left',
                      cursor: 'pointer',
                      transition: 'all 0.3s ease'
                    }}
                  >
                    <i className="icofont-check-circled" style={{ fontSize: '1.5rem', color: '#f0b90b', display: 'block', marginBottom: '0.5rem' }}></i>
                    <div style={{ color: '#f8fafc', fontWeight: 600, fontSize: '1rem' }}>Approve Investments</div>
                    <div style={{ color: '#94a3b8', fontSize: '0.875rem' }}>{pendingInvestments} pending</div>
                  </button>
                  <button
                    onClick={() => setActiveTab('withdrawals')}
                    style={{
                      padding: '1.5rem',
                      background: 'rgba(59,130,246,0.1)',
                      border: '1px solid rgba(59,130,246,0.3)',
                      borderRadius: '12px',
                      textAlign: 'left',
                      cursor: 'pointer',
                      transition: 'all 0.3s ease'
                    }}
                  >
                    <i className="icofont-pay" style={{ fontSize: '1.5rem', color: '#60a5fa', display: 'block', marginBottom: '0.5rem' }}></i>
                    <div style={{ color: '#f8fafc', fontWeight: 600, fontSize: '1rem' }}>Process Withdrawals</div>
                    <div style={{ color: '#94a3b8', fontSize: '0.875rem' }}>{pendingWithdrawals} pending</div>
                  </button>
                  <button
                    onClick={() => setActiveTab('kyc')}
                    style={{
                      padding: '1.5rem',
                      background: 'rgba(16,185,129,0.1)',
                      border: '1px solid rgba(16,185,129,0.3)',
                      borderRadius: '12px',
                      textAlign: 'left',
                      cursor: 'pointer',
                      transition: 'all 0.3s ease'
                    }}
                  >
                    <i className="icofont-verification-check" style={{ fontSize: '1.5rem', color: '#10b981', display: 'block', marginBottom: '0.5rem' }}></i>
                    <div style={{ color: '#f8fafc', fontWeight: 600, fontSize: '1rem' }}>Review KYC</div>
                    <div style={{ color: '#94a3b8', fontSize: '0.875rem' }}>{pendingKyc} pending</div>
                  </button>
                  <button
                    onClick={() => setActiveTab('users')}
                    style={{
                      padding: '1.5rem',
                      background: 'rgba(139,92,246,0.1)',
                      border: '1px solid rgba(139,92,246,0.3)',
                      borderRadius: '12px',
                      textAlign: 'left',
                      cursor: 'pointer',
                      transition: 'all 0.3s ease'
                    }}
                  >
                    <i className="icofont-users" style={{ fontSize: '1.5rem', color: '#a78bfa', display: 'block', marginBottom: '0.5rem' }}></i>
                    <div style={{ color: '#f8fafc', fontWeight: 600, fontSize: '1rem' }}>Manage Users</div>
                    <div style={{ color: '#94a3b8', fontSize: '0.875rem' }}>{totalUsers} total users</div>
                  </button>
                </div>
              </div>

              {/* Recent Activity */}
              <div style={{ marginTop: '2rem' }}>
                <h3 style={{ color: '#f8fafc', fontSize: '1.25rem', marginBottom: '1rem', fontWeight: 600 }}>
                  <i className="icofont-clock-time"></i> Recent Activity
                </h3>
                <div style={{
                  background: 'rgba(255,255,255,0.03)',
                  borderRadius: '12px',
                  border: '1px solid rgba(255,255,255,0.1)',
                  padding: '1.5rem'
                }}>
                  <div style={{ color: '#cbd5e1', fontSize: '0.875rem' }}>
                    <p style={{ marginBottom: '0.75rem' }}>
                      <i className="icofont-check-circled" style={{ color: '#10b981', marginRight: '0.5rem' }}></i>
                      System operational - All services running smoothly
                    </p>
                    <p style={{ marginBottom: '0.75rem' }}>
                      <i className="icofont-info-circle" style={{ color: '#60a5fa', marginRight: '0.5rem' }}></i>
                      {pendingInvestments + pendingWithdrawals + pendingKyc} items require your attention
                    </p>
                    <p style={{ margin: 0 }}>
                      <i className="icofont-users-alt-5" style={{ color: '#f0b90b', marginRight: '0.5rem' }}></i>
                      {totalUsers} registered users
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}

          {activeTab === 'users' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h3 style={{ color: '#f8fafc', fontSize: '1.25rem', fontWeight: 600 }}>
                  <i className="icofont-users-alt-5"></i> User Management
                </h3>
                <div style={{ color: '#94a3b8', fontSize: '0.875rem' }}>
                  Total Users: {totalUsers}
                </div>
              </div>

              <div style={{
                background: 'rgba(255,255,255,0.03)',
                borderRadius: '12px',
                overflow: 'hidden',
                border: '1px solid rgba(255,255,255,0.1)'
              }}>
                <div className="table-container">
                  <table className="admin-table" style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: '0.875rem'
                  }}>
                    <thead>
                      <tr style={{
                        background: 'rgba(240,185,11,0.1)',
                        borderBottom: '2px solid rgba(240,185,11,0.3)'
                      }}>
                        <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600, color: '#f0b90b', textTransform: 'uppercase', fontSize: '0.75rem' }}>ID</th>
                        <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600, color: '#f0b90b', textTransform: 'uppercase', fontSize: '0.75rem' }}>Name</th>
                        <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600, color: '#f0b90b', textTransform: 'uppercase', fontSize: '0.75rem' }}>Email</th>
                        <th style={{ padding: '1rem', textAlign: 'right', fontWeight: 600, color: '#f0b90b', textTransform: 'uppercase', fontSize: '0.75rem' }}>Balance</th>
                        <th style={{ padding: '1rem', textAlign: 'center', fontWeight: 600, color: '#f0b90b', textTransform: 'uppercase', fontSize: '0.75rem' }}>Status</th>
                        <th style={{ padding: '1rem', textAlign: 'center', fontWeight: 600, color: '#f0b90b', textTransform: 'uppercase', fontSize: '0.75rem' }}>Actions</th>
                      </tr>
                    </thead>
                  <tbody>
                    {allUsers.filter(user => user.idnum !== currentAdmin?.idnum).map((user, idx) => (
                      <tr
                        key={user.id || idx}
                        style={{
                          borderBottom: '1px solid rgba(255,255,255,0.05)',
                          transition: 'all 0.3s ease'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'rgba(240,185,11,0.05)'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent'
                        }}
                      >
                        <td style={{ padding: '1rem', color: '#cbd5e1' }}>{user.idnum}</td>
                        <td style={{ padding: '1rem', color: '#f8fafc', fontWeight: 500 }}>{user.name || user.userName}</td>
                        <td style={{ padding: '1rem', color: '#cbd5e1' }}>{user.email}</td>
                        <td style={{ padding: '1rem', textAlign: 'right', color: '#10b981', fontWeight: 600 }}>
                          ${(user.balance || 0).toLocaleString()}
                        </td>
                        <td style={{ padding: '1rem', textAlign: 'center' }}>
                          <span style={{
                            padding: '0.375rem 0.875rem',
                            borderRadius: '20px',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            background: 'rgba(34,197,94,0.15)',
                            color: '#4ade80',
                            border: '1px solid rgba(34,197,94,0.3)'
                          }}>
                            Active
                          </span>
                        </td>
                        <td style={{ padding: '1rem', textAlign: 'center' }}>
                          <button
                            onClick={() => handleViewUser(user)}
                            style={{
                              padding: '0.5rem 1rem',
                              background: 'rgba(59,130,246,0.1)',
                              border: '1px solid rgba(59,130,246,0.3)',
                              borderRadius: '6px',
                              color: '#60a5fa',
                              fontSize: '0.75rem',
                              cursor: 'pointer',
                              fontWeight: 500
                            }}
                          >
                            <i className="icofont-eye"></i> View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'investments' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h3 style={{ color: '#f8fafc', fontSize: '1.25rem', fontWeight: 600 }}>
                  <i className="icofont-chart-growth"></i> Investment Management
                </h3>
                <div style={{ color: '#94a3b8', fontSize: '0.875rem' }}>
                  Total: ${totalInvestments.toLocaleString()} | Pending: {pendingInvestments}
                </div>
              </div>

              <div style={{
                background: 'rgba(255,255,255,0.03)',
                borderRadius: '12px',
                overflow: 'hidden',
                border: '1px solid rgba(255,255,255,0.1)'
              }}>
                <div className="table-container">
                  <table className="admin-table" style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: '0.875rem'
                  }}>
                  <thead>
                    <tr style={{
                      background: 'rgba(240,185,11,0.1)',
                      borderBottom: '2px solid rgba(240,185,11,0.3)'
                    }}>
                      <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600, color: '#f0b90b', textTransform: 'uppercase', fontSize: '0.75rem' }}>User</th>
                      <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600, color: '#f0b90b', textTransform: 'uppercase', fontSize: '0.75rem' }}>Plan</th>
                      <th style={{ padding: '1rem', textAlign: 'right', fontWeight: 600, color: '#f0b90b', textTransform: 'uppercase', fontSize: '0.75rem' }}>Amount</th>
                      <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600, color: '#f0b90b', textTransform: 'uppercase', fontSize: '0.75rem' }}>Date</th>
                      <th style={{ padding: '1rem', textAlign: 'center', fontWeight: 600, color: '#f0b90b', textTransform: 'uppercase', fontSize: '0.75rem' }}>Payment Proof</th>
                      <th style={{ padding: '1rem', textAlign: 'center', fontWeight: 600, color: '#f0b90b', textTransform: 'uppercase', fontSize: '0.75rem' }}>Transaction</th>
                      <th style={{ padding: '1rem', textAlign: 'center', fontWeight: 600, color: '#f0b90b', textTransform: 'uppercase', fontSize: '0.75rem' }}>Status</th>
                      <th style={{ padding: '1rem', textAlign: 'center', fontWeight: 600, color: '#f0b90b', textTransform: 'uppercase', fontSize: '0.75rem' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allInvestments.length === 0 ? (
                      <tr>
                        <td colSpan={8} style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>
                          <i className="icofont-chart-growth" style={{ fontSize: '3rem', marginBottom: '1rem', display: 'block', opacity: 0.5 }}></i>
                          No investment records found
                        </td>
                      </tr>
                    ) : (
                      allInvestments
                        .filter(inv => {
                          // Find the user for this investment
                          const user = allUsers.find(u => u.idnum === inv.idnum)
                          // Filter out investments from admin/superadmin users
                          return user && user.role !== 'admin' && user.role !== 'superadmin'
                        })
                        .map((inv, idx) => (
                      <tr
                        key={inv.id || idx}
                        style={{
                          borderBottom: '1px solid rgba(255,255,255,0.05)'
                        }}
                      >
                        <td style={{ padding: '1rem', color: '#f8fafc', fontWeight: 500 }}>{inv.userName}</td>
                        <td style={{ padding: '1rem', color: '#cbd5e1' }}>{inv.plan}</td>
                        <td style={{ padding: '1rem', textAlign: 'right', color: '#10b981', fontWeight: 600 }}>
                          ${(inv.capital || 0).toLocaleString()}
                        </td>
                        <td style={{ padding: '1rem', color: '#cbd5e1' }}>
                          {new Date(inv.created_at || inv.date).toLocaleDateString()}
                        </td>
                        <td style={{ padding: '1rem', textAlign: 'center' }}>
                          {inv.paymentProofUrl ? (
                            <button
                              onClick={() => handleViewPaymentProof(inv.paymentProofUrl)}
                              style={{
                                padding: '0.375rem 0.75rem',
                                background: 'rgba(59,130,246,0.1)',
                                border: '1px solid rgba(59,130,246,0.3)',
                                borderRadius: '6px',
                                color: '#3b82f6',
                                fontSize: '0.75rem',
                                cursor: 'pointer',
                                fontWeight: 500
                              }}
                            >
                              <i className="icofont-image"></i> View
                            </button>
                          ) : (
                            <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>No proof</span>
                          )}
                        </td>
                        <td style={{ padding: '1rem', textAlign: 'center' }}>
                          {inv.transactionHash ? (
                            <button
                              onClick={() => handleViewTransaction(inv.transactionHash, inv.paymentOption)}
                              style={{
                                padding: '0.375rem 0.75rem',
                                background: 'rgba(139,92,246,0.1)',
                                border: '1px solid rgba(139,92,246,0.3)',
                                borderRadius: '6px',
                                color: '#8b5cf6',
                                fontSize: '0.75rem',
                                cursor: 'pointer',
                                fontWeight: 500
                              }}
                            >
                              <i className="icofont-link"></i> View
                            </button>
                          ) : (
                            <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>No hash</span>
                          )}
                        </td>
                        <td style={{ padding: '1rem', textAlign: 'center' }}>
                          <span style={{
                            padding: '0.375rem 0.875rem',
                            borderRadius: '20px',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            background: inv.status === 'Pending' ? 'rgba(251,191,36,0.15)' :
                                       inv.status === 'Active' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                            color: inv.status === 'Pending' ? '#fbbf24' :
                                   inv.status === 'Active' ? '#4ade80' : '#ef4444',
                            border: `1px solid ${inv.status === 'Pending' ? 'rgba(251,191,36,0.3)' :
                                                 inv.status === 'Active' ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`
                          }}>
                            {inv.status}
                          </span>
                        </td>
                        <td style={{ padding: '1rem', textAlign: 'center' }}>
                          {inv.status === 'Pending' && (
                            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                              <button
                                onClick={() => handleApproveInvestment(inv.id)}
                                style={{
                                  padding: '0.5rem 1rem',
                                  background: 'rgba(34,197,94,0.1)',
                                  border: '1px solid rgba(34,197,94,0.3)',
                                  borderRadius: '6px',
                                  color: '#10b981',
                                  fontSize: '0.75rem',
                                  cursor: 'pointer',
                                  fontWeight: 500
                                }}
                              >
                                <i className="icofont-check"></i> Approve
                              </button>
                              <button
                                onClick={() => handleRejectInvestment(inv.id)}
                                style={{
                                  padding: '0.5rem 1rem',
                                  background: 'rgba(239,68,68,0.1)',
                                  border: '1px solid rgba(239,68,68,0.3)',
                                  borderRadius: '6px',
                                  color: '#ef4444',
                                  fontSize: '0.75rem',
                                  cursor: 'pointer',
                                  fontWeight: 500
                                }}
                              >
                                <i className="icofont-close"></i> Reject
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                      ))
                    )}
                  </tbody>
                </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'deposits' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h3 style={{ color: '#f8fafc', fontSize: '1.25rem', fontWeight: 600 }}>
                  <i className="icofont-download"></i> Deposit Management
                </h3>
                <div style={{ color: '#94a3b8', fontSize: '0.875rem' }}>
                  Total Deposits: ${allDeposits.reduce((sum, d) => sum + (d.amount || 0), 0).toLocaleString()}
                </div>
              </div>

              <div style={{
                background: 'rgba(255,255,255,0.03)',
                borderRadius: '12px',
                overflow: 'hidden',
                border: '1px solid rgba(255,255,255,0.1)'
              }}>
                <div className="table-container">
                  <table className="admin-table" style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: '0.875rem'
                  }}>
                  <thead>
                    <tr style={{
                      background: 'rgba(240,185,11,0.1)',
                      borderBottom: '2px solid rgba(240,185,11,0.3)'
                    }}>
                      <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600, color: '#f0b90b', textTransform: 'uppercase', fontSize: '0.75rem' }}>User</th>
                      <th style={{ padding: '1rem', textAlign: 'right', fontWeight: 600, color: '#f0b90b', textTransform: 'uppercase', fontSize: '0.75rem' }}>Amount</th>
                      <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600, color: '#f0b90b', textTransform: 'uppercase', fontSize: '0.75rem' }}>Method</th>
                      <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600, color: '#f0b90b', textTransform: 'uppercase', fontSize: '0.75rem' }}>Date</th>
                      <th style={{ padding: '1rem', textAlign: 'center', fontWeight: 600, color: '#f0b90b', textTransform: 'uppercase', fontSize: '0.75rem' }}>Proof</th>
                      <th style={{ padding: '1rem', textAlign: 'center', fontWeight: 600, color: '#f0b90b', textTransform: 'uppercase', fontSize: '0.75rem' }}>Status</th>
                      <th style={{ padding: '1rem', textAlign: 'center', fontWeight: 600, color: '#f0b90b', textTransform: 'uppercase', fontSize: '0.75rem' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allDeposits.length === 0 ? (
                      <tr>
                        <td colSpan={7} style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>
                          <i className="icofont-download" style={{ fontSize: '3rem', marginBottom: '1rem', display: 'block', opacity: 0.5 }}></i>
                          No deposit records found
                        </td>
                      </tr>
                    ) : (
                      allDeposits.map((deposit, idx) => {
                        return (
                      <tr
                        key={deposit.id || idx}
                        style={{
                          borderBottom: '1px solid rgba(255,255,255,0.05)'
                        }}
                      >
                        <td style={{ padding: '1rem', color: '#f8fafc', fontWeight: 500 }}>{deposit.userName || 'Unknown User'}</td>
                        <td style={{ padding: '1rem', textAlign: 'right', color: '#10b981', fontWeight: 600 }}>
                          ${(deposit.amount || 0).toLocaleString()}
                        </td>
                        <td style={{ padding: '1rem', color: '#cbd5e1' }}>{deposit.method}</td>
                        <td style={{ padding: '1rem', color: '#cbd5e1' }}>
                          {new Date(deposit.created_at).toLocaleDateString()}
                        </td>
                        <td style={{ padding: '1rem', textAlign: 'center' }}>
                          {deposit.proof_url ? (
                            <button
                              onClick={() => handleViewPaymentProof(deposit.proof_url)}
                              style={{
                                padding: '0.375rem 0.75rem',
                                background: 'rgba(59,130,246,0.1)',
                                border: '1px solid rgba(59,130,246,0.3)',
                                borderRadius: '6px',
                                color: '#3b82f6',
                                fontSize: '0.75rem',
                                cursor: 'pointer',
                                fontWeight: 500
                              }}
                            >
                              <i className="icofont-image"></i> View
                            </button>
                          ) : (
                            <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>No proof</span>
                          )}
                        </td>
                        <td style={{ padding: '1rem', textAlign: 'center' }}>
                          <span style={{
                            padding: '0.375rem 0.875rem',
                            borderRadius: '20px',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            background: deposit.status?.toLowerCase() === 'pending' ? 'rgba(251,191,36,0.15)' :
                                       deposit.status?.toLowerCase() === 'approved' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                            color: deposit.status?.toLowerCase() === 'pending' ? '#fbbf24' :
                                   deposit.status?.toLowerCase() === 'approved' ? '#4ade80' : '#ef4444',
                            border: `1px solid ${deposit.status?.toLowerCase() === 'pending' ? 'rgba(251,191,36,0.3)' :
                                                 deposit.status?.toLowerCase() === 'approved' ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`
                          }}>
                            {deposit.status}
                          </span>
                        </td>
                        <td style={{ padding: '1rem', textAlign: 'center' }}>
                          {deposit.status?.toLowerCase() === 'pending' && (
                            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                              <button
                                onClick={() => handleApproveDeposit(deposit.id, deposit.idnum, deposit.amount)}
                                style={{
                                  padding: '0.5rem 1rem',
                                  background: 'rgba(34,197,94,0.1)',
                                  border: '1px solid rgba(34,197,94,0.3)',
                                  borderRadius: '6px',
                                  color: '#10b981',
                                  fontSize: '0.75rem',
                                  cursor: 'pointer',
                                  fontWeight: 500
                                }}
                              >
                                <i className="icofont-check"></i> Approve
                              </button>
                              <button
                                onClick={() => handleRejectDeposit(deposit.id)}
                                style={{
                                  padding: '0.5rem 1rem',
                                  background: 'rgba(239,68,68,0.1)',
                                  border: '1px solid rgba(239,68,68,0.3)',
                                  borderRadius: '6px',
                                  color: '#ef4444',
                                  fontSize: '0.75rem',
                                  cursor: 'pointer',
                                  fontWeight: 500
                                }}
                              >
                                <i className="icofont-close"></i> Reject
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                      )})
                    )}
                  </tbody>
                </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'withdrawals' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h3 style={{ color: '#f8fafc', fontSize: '1.25rem', fontWeight: 600 }}>
                  <i className="icofont-money"></i> Withdrawal Management
                </h3>
                <div style={{ color: '#94a3b8', fontSize: '0.875rem' }}>
                  Total: ${totalWithdrawals.toLocaleString()} | Pending: {pendingWithdrawals}
                </div>
              </div>

              <div style={{
                background: 'rgba(255,255,255,0.03)',
                borderRadius: '12px',
                overflow: 'hidden',
                border: '1px solid rgba(255,255,255,0.1)'
              }}>
                <div className="table-container">
                  <table className="admin-table" style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: '0.875rem'
                  }}>
                  <thead>
                    <tr style={{
                      background: 'rgba(240,185,11,0.1)',
                      borderBottom: '2px solid rgba(240,185,11,0.3)'
                    }}>
                      <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600, color: '#f0b90b', textTransform: 'uppercase', fontSize: '0.75rem' }}>User</th>
                      <th style={{ padding: '1rem', textAlign: 'right', fontWeight: 600, color: '#f0b90b', textTransform: 'uppercase', fontSize: '0.75rem' }}>Amount</th>
                      <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600, color: '#f0b90b', textTransform: 'uppercase', fontSize: '0.75rem' }}>Method</th>
                      <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600, color: '#f0b90b', textTransform: 'uppercase', fontSize: '0.75rem' }}>Details</th>
                      <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600, color: '#f0b90b', textTransform: 'uppercase', fontSize: '0.75rem' }}>Date</th>
                      <th style={{ padding: '1rem', textAlign: 'center', fontWeight: 600, color: '#f0b90b', textTransform: 'uppercase', fontSize: '0.75rem' }}>Status</th>
                      <th style={{ padding: '1rem', textAlign: 'center', fontWeight: 600, color: '#f0b90b', textTransform: 'uppercase', fontSize: '0.75rem' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allWithdrawals.length === 0 ? (
                      <tr>
                        <td colSpan={7} style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>
                          <i className="icofont-money" style={{ fontSize: '3rem', marginBottom: '1rem', display: 'block', opacity: 0.5 }}></i>
                          No withdrawal records found
                        </td>
                      </tr>
                    ) : (
                      allWithdrawals.map((withdrawal, idx) => (
                      <tr
                        key={withdrawal.id || idx}
                        style={{
                          borderBottom: '1px solid rgba(255,255,255,0.05)'
                        }}
                      >
                        <td style={{ padding: '1rem', color: '#f8fafc', fontWeight: 500 }}>{withdrawal.userName}</td>
                        <td style={{ padding: '1rem', textAlign: 'right', color: '#ef4444', fontWeight: 600 }}>
                          ${(withdrawal.amount || 0).toLocaleString()}
                        </td>
                        <td style={{ padding: '1rem', color: '#cbd5e1' }}>{withdrawal.method}</td>
                        <td style={{ padding: '1rem', color: '#94a3b8', fontSize: '0.75rem', maxWidth: '200px' }}>
                          {withdrawal.method === 'Bank Transfer' ? (
                            <>
                              <div style={{color: '#f8fafc', fontWeight: 500}}>{withdrawal.bankName}</div>
                              <div>{withdrawal.accountNumber}</div>
                              <div>{withdrawal.accountName}</div>
                              {withdrawal.routingNumber && <div>Routing: {withdrawal.routingNumber}</div>}
                            </>
                          ) : (
                            <>
                              <div style={{wordBreak: 'break-all'}}>{withdrawal.wallet || withdrawal.walletAddress}</div>
                            </>
                          )}
                        </td>
                        <td style={{ padding: '1rem', color: '#cbd5e1' }}>
                          {new Date(withdrawal.date).toLocaleDateString()}
                        </td>
                        <td style={{ padding: '1rem', textAlign: 'center' }}>
                          <span style={{
                            padding: '0.375rem 0.875rem',
                            borderRadius: '20px',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            background: withdrawal.status?.toLowerCase() === 'pending' ? 'rgba(251,191,36,0.15)' :
                                       withdrawal.status?.toLowerCase() === 'approved' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                            color: withdrawal.status?.toLowerCase() === 'pending' ? '#fbbf24' :
                                   withdrawal.status?.toLowerCase() === 'approved' ? '#4ade80' : '#ef4444',
                            border: `1px solid ${withdrawal.status?.toLowerCase() === 'pending' ? 'rgba(251,191,36,0.3)' :
                                                 withdrawal.status?.toLowerCase() === 'approved' ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`
                          }}>
                            {withdrawal.status}
                          </span>
                        </td>
                        <td style={{ padding: '1rem', textAlign: 'center' }}>
                          {withdrawal.status?.toLowerCase() === 'pending' && (
                            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                              <button
                                onClick={() => handleApproveWithdrawal(withdrawal.id)}
                                style={{
                                  padding: '0.5rem 1rem',
                                  background: 'rgba(34,197,94,0.1)',
                                  border: '1px solid rgba(34,197,94,0.3)',
                                  borderRadius: '6px',
                                  color: '#10b981',
                                  fontSize: '0.75rem',
                                  cursor: 'pointer',
                                  fontWeight: 500
                                }}
                              >
                                <i className="icofont-check"></i> Approve
                              </button>
                              <button
                                onClick={() => handleRejectWithdrawal(withdrawal.id)}
                                style={{
                                  padding: '0.5rem 1rem',
                                  background: 'rgba(239,68,68,0.1)',
                                  border: '1px solid rgba(239,68,68,0.3)',
                                  borderRadius: '6px',
                                  color: '#ef4444',
                                  fontSize: '0.75rem',
                                  cursor: 'pointer',
                                  fontWeight: 500
                                }}
                              >
                                <i className="icofont-close"></i> Reject
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                      ))
                    )}
                  </tbody>
                </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'kyc' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h3 style={{ color: '#f8fafc', fontSize: '1.25rem', fontWeight: 600 }}>
                  <i className="icofont-id-card"></i> KYC Verification Requests
                </h3>
                <div style={{ color: '#94a3b8', fontSize: '0.875rem' }}>
                  Pending: {pendingKyc}
                </div>
              </div>

              <div style={{
                background: 'rgba(255,255,255,0.03)',
                borderRadius: '12px',
                overflow: 'hidden',
                border: '1px solid rgba(255,255,255,0.1)'
              }}>
                <div className="table-container">
                  <table className="admin-table" style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: '0.875rem'
                  }}>
                  <thead>
                    <tr style={{
                      background: 'rgba(240,185,11,0.1)',
                      borderBottom: '2px solid rgba(240,185,11,0.3)'
                    }}>
                      <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600, color: '#f0b90b', textTransform: 'uppercase', fontSize: '0.75rem' }}>User</th>
                      <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600, color: '#f0b90b', textTransform: 'uppercase', fontSize: '0.75rem' }}>Email</th>
                      <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600, color: '#f0b90b', textTransform: 'uppercase', fontSize: '0.75rem' }}>Document</th>
                      <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600, color: '#f0b90b', textTransform: 'uppercase', fontSize: '0.75rem' }}>Submitted</th>
                      <th style={{ padding: '1rem', textAlign: 'center', fontWeight: 600, color: '#f0b90b', textTransform: 'uppercase', fontSize: '0.75rem' }}>Files</th>
                      <th style={{ padding: '1rem', textAlign: 'center', fontWeight: 600, color: '#f0b90b', textTransform: 'uppercase', fontSize: '0.75rem' }}>Status</th>
                      <th style={{ padding: '1rem', textAlign: 'center', fontWeight: 600, color: '#f0b90b', textTransform: 'uppercase', fontSize: '0.75rem' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allKycRequests.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="admin-table__empty" style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>
                          <i className="icofont-id-card" style={{ fontSize: '3rem', marginBottom: '1rem', display: 'block', opacity: 0.5 }}></i>
                          No KYC submissions yet
                        </td>
                      </tr>
                    ) : (
                      allKycRequests.map((kyc, idx) => {
                        const submittedAt = kyc.submittedAt || kyc.created_at
                        const formattedDocumentType =
                          kyc.documentType === 'drivers_license'
                            ? "Driver's License"
                            : kyc.documentType === 'national_id'
                              ? 'National ID Card'
                              : kyc.documentType === 'passport'
                                ? 'Passport'
                                : kyc.documentType || 'Unknown document'
                        const isPendingRow = isStatus(kyc.status, 'pending')

                        return (
                          <tr
                            key={kyc.id || idx}
                            style={{
                              borderBottom: '1px solid rgba(255,255,255,0.05)'
                            }}
                          >
                            <td style={{ padding: '1rem', color: '#f8fafc', fontWeight: 500 }}>{kyc.userName}</td>
                            <td style={{ padding: '1rem', color: '#cbd5e1' }}>{kyc.userEmail || 'No email'}</td>
                            <td style={{ padding: '1rem', color: '#cbd5e1' }}>
                              <div className="admin-table__text-wrap">
                                <strong style={{ color: '#f8fafc', display: 'block', marginBottom: '0.25rem' }}>{formattedDocumentType}</strong>
                                <span>{kyc.documentNumber || 'No document number'}</span>
                              </div>
                            </td>
                            <td style={{ padding: '1rem', color: '#cbd5e1' }}>
                              {submittedAt ? new Date(submittedAt).toLocaleString() : 'Unknown'}
                            </td>
                            <td style={{ padding: '1rem', textAlign: 'center' }}>
                              <div className="admin-table__actions">
                                {kyc.documentFrontUrl && (
                                  <button
                                    onClick={() => openExternalDocument(kyc.documentFrontUrl)}
                                    style={{
                                      padding: '0.375rem 0.75rem',
                                      background: 'rgba(59,130,246,0.1)',
                                      border: '1px solid rgba(59,130,246,0.3)',
                                      borderRadius: '6px',
                                      color: '#60a5fa',
                                      fontSize: '0.75rem',
                                      cursor: 'pointer',
                                      fontWeight: 500
                                    }}
                                  >
                                    ID
                                  </button>
                                )}
                                {kyc.documentBackUrl && (
                                  <button
                                    onClick={() => openExternalDocument(kyc.documentBackUrl)}
                                    style={{
                                      padding: '0.375rem 0.75rem',
                                      background: 'rgba(14,165,233,0.1)',
                                      border: '1px solid rgba(14,165,233,0.3)',
                                      borderRadius: '6px',
                                      color: '#38bdf8',
                                      fontSize: '0.75rem',
                                      cursor: 'pointer',
                                      fontWeight: 500
                                    }}
                                  >
                                    Address
                                  </button>
                                )}
                                {kyc.selfieUrl && (
                                  <button
                                    onClick={() => openExternalDocument(kyc.selfieUrl)}
                                    style={{
                                      padding: '0.375rem 0.75rem',
                                      background: 'rgba(168,85,247,0.1)',
                                      border: '1px solid rgba(168,85,247,0.3)',
                                      borderRadius: '6px',
                                      color: '#c084fc',
                                      fontSize: '0.75rem',
                                      cursor: 'pointer',
                                      fontWeight: 500
                                    }}
                                  >
                                    Selfie
                                  </button>
                                )}
                                {!kyc.documentFrontUrl && !kyc.documentBackUrl && !kyc.selfieUrl && (
                                  <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>No files</span>
                                )}
                              </div>
                            </td>
                            <td style={{ padding: '1rem', textAlign: 'center' }}>
                              <span className="table-status-badge" style={{
                                padding: '0.375rem 0.875rem',
                                borderRadius: '20px',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                background: isPendingRow ? 'rgba(251,191,36,0.15)' :
                                           isStatus(kyc.status, 'approved') ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                                color: isPendingRow ? '#fbbf24' :
                                       isStatus(kyc.status, 'approved') ? '#4ade80' : '#ef4444',
                                border: `1px solid ${isPendingRow ? 'rgba(251,191,36,0.3)' :
                                                     isStatus(kyc.status, 'approved') ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`
                              }}>
                                {kyc.status || 'Unknown'}
                              </span>
                            </td>
                            <td style={{ padding: '1rem', textAlign: 'center' }}>
                              {isPendingRow ? (
                                <div className="admin-table__actions">
                                  <button
                                    onClick={() => handleApproveKyc(kyc.id)}
                                    disabled={kycActionId === kyc.id}
                                    style={{
                                      padding: '0.5rem 1rem',
                                      background: 'rgba(34,197,94,0.1)',
                                      border: '1px solid rgba(34,197,94,0.3)',
                                      borderRadius: '6px',
                                      color: '#10b981',
                                      fontSize: '0.75rem',
                                      cursor: kycActionId === kyc.id ? 'not-allowed' : 'pointer',
                                      fontWeight: 500,
                                      opacity: kycActionId === kyc.id ? 0.6 : 1
                                    }}
                                  >
                                    <i className="icofont-check"></i> {kycActionId === kyc.id ? 'Working...' : 'Approve'}
                                  </button>
                                  <button
                                    onClick={() => handleRejectKyc(kyc.id)}
                                    disabled={kycActionId === kyc.id}
                                    style={{
                                      padding: '0.5rem 1rem',
                                      background: 'rgba(239,68,68,0.1)',
                                      border: '1px solid rgba(239,68,68,0.3)',
                                      borderRadius: '6px',
                                      color: '#ef4444',
                                      fontSize: '0.75rem',
                                      cursor: kycActionId === kyc.id ? 'not-allowed' : 'pointer',
                                      fontWeight: 500,
                                      opacity: kycActionId === kyc.id ? 0.6 : 1
                                    }}
                                  >
                                    <i className="icofont-close"></i> Reject
                                  </button>
                                </div>
                              ) : (
                                <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>
                                  {isStatus(kyc.status, 'approved') ? 'Approved' : 'Reviewed'}
                                </span>
                              )}
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
                </div>
              </div>
            </div>
          )}

          {/* Loans Management Tab */}
          {activeTab === 'loans' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h3 style={{ color: '#f8fafc', fontSize: '1.25rem', fontWeight: 600 }}>
                  <i className="icofont-money-bag"></i> Loan Requests
                </h3>
                <div style={{ color: '#94a3b8', fontSize: '0.875rem' }}>
                  Total: ${totalLoanAmount.toLocaleString()} | Pending: {pendingLoans}
                </div>
              </div>

              {/* Loan Stats */}
              <div className="stats-grid" style={{ marginBottom: '2rem' }}>
                <div className="stat-card primary">
                  <div className="stat-icon">
                    <i className="icofont-tasks-alt"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">Total Requests</p>
                    <h2 className="stat-value">{allLoans.length}</h2>
                    <p className="stat-info">All loan applications</p>
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon" style={{ background: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b' }}>
                    <i className="icofont-clock-time"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">Pending Review</p>
                    <h2 className="stat-value">{pendingLoans}</h2>
                    <p className="stat-info">Awaiting approval</p>
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon" style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981' }}>
                    <i className="icofont-check-circled"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">Approved</p>
                    <h2 className="stat-value">{allLoans.filter(l => l.status === 'approved').length}</h2>
                    <p className="stat-info">Successfully processed</p>
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon" style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}>
                    <i className="icofont-close-circled"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">Rejected</p>
                    <h2 className="stat-value">{allLoans.filter(l => l.status === 'rejected').length}</h2>
                    <p className="stat-info">Declined applications</p>
                  </div>
                </div>
              </div>

              <div style={{
                background: 'rgba(255,255,255,0.03)',
                borderRadius: '12px',
                overflow: 'hidden',
                border: '1px solid rgba(255,255,255,0.1)'
              }}>
                <div className="table-container">
                  <table className="admin-table" style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: '0.875rem'
                  }}>
                    <thead>
                      <tr style={{
                        background: 'rgba(240,185,11,0.1)',
                        borderBottom: '2px solid rgba(240,185,11,0.3)'
                      }}>
                        <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600, color: '#f0b90b', textTransform: 'uppercase', fontSize: '0.75rem' }}>User</th>
                        <th style={{ padding: '1rem', textAlign: 'right', fontWeight: 600, color: '#f0b90b', textTransform: 'uppercase', fontSize: '0.75rem' }}>Amount</th>
                        <th style={{ padding: '1rem', textAlign: 'center', fontWeight: 600, color: '#f0b90b', textTransform: 'uppercase', fontSize: '0.75rem' }}>Duration</th>
                        <th style={{ padding: '1rem', textAlign: 'center', fontWeight: 600, color: '#f0b90b', textTransform: 'uppercase', fontSize: '0.75rem' }}>Interest</th>
                        <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600, color: '#f0b90b', textTransform: 'uppercase', fontSize: '0.75rem' }}>Purpose</th>
                        <th style={{ padding: '1rem', textAlign: 'center', fontWeight: 600, color: '#f0b90b', textTransform: 'uppercase', fontSize: '0.75rem' }}>Status</th>
                        <th style={{ padding: '1rem', textAlign: 'center', fontWeight: 600, color: '#f0b90b', textTransform: 'uppercase', fontSize: '0.75rem' }}>Date</th>
                        <th style={{ padding: '1rem', textAlign: 'center', fontWeight: 600, color: '#f0b90b', textTransform: 'uppercase', fontSize: '0.75rem' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allLoans.length === 0 ? (
                        <tr>
                          <td colSpan={8} style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>
                            <i className="icofont-money-bag" style={{ fontSize: '3rem', marginBottom: '1rem', display: 'block', opacity: 0.5 }}></i>
                            No loan requests found
                          </td>
                        </tr>
                      ) : (
                        allLoans.map((loan, index) => (
                          <tr
                            key={loan.id || index}
                            style={{
                              borderBottom: '1px solid rgba(255,255,255,0.05)',
                              transition: 'all 0.3s ease'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = 'rgba(240,185,11,0.05)'
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'transparent'
                            }}
                          >
                            <td style={{ padding: '1rem', color: '#f8fafc', fontWeight: 500 }}>
                              <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <span>{loan.userName}</span>
                                <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 400 }}>{loan.userEmail}</span>
                              </div>
                            </td>
                            <td style={{ padding: '1rem', textAlign: 'right', color: '#f0b90b', fontWeight: 600 }}>
                              ${loan.amount?.toLocaleString() || '0'}
                            </td>
                            <td style={{ padding: '1rem', textAlign: 'center', color: '#cbd5e1' }}>
                              {loan.duration || 30} days
                            </td>
                            <td style={{ padding: '1rem', textAlign: 'center', color: '#cbd5e1' }}>
                              {loan.interestRate || 5}%
                            </td>
                            <td style={{ padding: '1rem', color: '#cbd5e1', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {loan.purpose || 'N/A'}
                            </td>
                            <td style={{ padding: '1rem', textAlign: 'center' }}>
                              <span style={{
                                padding: '0.375rem 0.875rem',
                                borderRadius: '20px',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                background: loan.status === 'approved' ? 'rgba(34,197,94,0.15)' :
                                         loan.status === 'rejected' ? 'rgba(239,68,68,0.15)' :
                                         'rgba(245,158,11,0.15)',
                                color: loan.status === 'approved' ? '#4ade80' :
                                       loan.status === 'rejected' ? '#f87171' :
                                       '#fbbf24',
                                border: `1px solid ${loan.status === 'approved' ? 'rgba(34,197,94,0.3)' :
                                                 loan.status === 'rejected' ? 'rgba(239,68,68,0.3)' :
                                                 'rgba(245,158,11,0.3)'}`
                              }}>
                                {loan.status || 'Pending'}
                              </span>
                            </td>
                            <td style={{ padding: '1rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.875rem' }}>
                              {loan.date ? new Date(loan.date).toLocaleDateString() : 'N/A'}
                            </td>
                            <td style={{ padding: '1rem', textAlign: 'center' }}>
                              {loan.status === 'pending' && (
                                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                                  <button
                                    onClick={() => handleApproveLoan(loan)}
                                    style={{
                                      padding: '0.5rem 1rem',
                                      background: 'rgba(34,197,94,0.1)',
                                      border: '1px solid rgba(34,197,94,0.3)',
                                      borderRadius: '6px',
                                      color: '#10b981',
                                      fontSize: '0.75rem',
                                      cursor: 'pointer',
                                      fontWeight: 500,
                                      transition: 'all 0.3s ease'
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.background = 'rgba(34,197,94,0.2)'
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.background = 'rgba(34,197,94,0.1)'
                                    }}
                                  >
                                    <i className="icofont-check"></i> Approve
                                  </button>
                                  <button
                                    onClick={() => handleRejectLoan(loan)}
                                    style={{
                                      padding: '0.5rem 1rem',
                                      background: 'rgba(239,68,68,0.1)',
                                      border: '1px solid rgba(239,68,68,0.3)',
                                      borderRadius: '6px',
                                      color: '#ef4444',
                                      fontSize: '0.75rem',
                                      cursor: 'pointer',
                                      fontWeight: 500,
                                      transition: 'all 0.3s ease'
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.background = 'rgba(239,68,68,0.2)'
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.background = 'rgba(239,68,68,0.1)'
                                    }}
                                  >
                                    <i className="icofont-close"></i> Reject
                                  </button>
                                </div>
                              )}
                              {loan.status !== 'pending' && (
                                <span style={{
                                  color: loan.status === 'approved' ? '#10b981' : '#ef4444',
                                  fontSize: '0.75rem',
                                  fontWeight: 600
                                }}>
                                  {loan.status === 'approved' ? '✓ Approved' : '✗ Rejected'}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Bonus Management Tab */}
          {activeTab === 'bonus' && (
            <div className="page-section">
              <div className="page-header">
                <h2><i className="icofont-gift"></i> Bonus Management</h2>
                <button
                  className="primary-btn"
                  onClick={() => setShowAddBonusModal(true)}
                  style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' }}
                >
                  <i className="icofont-plus"></i> Add Bonus
                </button>
              </div>

              {/* Bonus Stats */}
              <div className="stats-grid" style={{ marginBottom: '2rem' }}>
                <div className="stat-card primary">
                  <div className="stat-icon">
                    <i className="icofont-gift"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">Total Bonus Distributed</p>
                    <h2 className="stat-value">${allUsers.reduce((sum, user) => sum + (user.bonus || 0), 0).toLocaleString()}</h2>
                    <p className="stat-info">Across all users</p>
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon" style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981' }}>
                    <i className="icofont-users-alt-5"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">Users with Bonus</p>
                    <h2 className="stat-value">{allUsers.filter(user => (user.bonus || 0) > 0).length}</h2>
                    <p className="stat-info">Active bonus holders</p>
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon" style={{ background: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b' }}>
                    <i className="icofont-chart-line"></i>
                  </div>
                  <div className="stat-details">
                    <p className="stat-label">Average Bonus</p>
                    <h2 className="stat-value">
                      ${allUsers.length > 0 ? Math.round(allUsers.reduce((sum, user) => sum + (user.bonus || 0), 0) / allUsers.length).toLocaleString() : '0'}
                    </h2>
                    <p className="stat-info">Per user</p>
                  </div>
                </div>
              </div>

              {/* Users with Bonus Table */}
              <div className="profile-card">
                <div className="profile-card-header">
                  <h3><i className="icofont-users-alt-5"></i> Users with Bonus</h3>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input
                      type="text"
                      placeholder="Search users..."
                      value={bonusSearchTerm}
                      onChange={(e) => setBonusSearchTerm(e.target.value)}
                      style={{
                        padding: '0.5rem 1rem',
                        borderRadius: '8px',
                        border: '1px solid rgba(255,255,255,0.1)',
                        background: 'rgba(255,255,255,0.05)',
                        color: '#fff',
                        fontSize: '0.875rem'
                      }}
                    />
                  </div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="admin-table admin-table--detail" style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                        <th style={{ padding: '12px 16px', textAlign: 'left', color: 'rgba(255,255,255,0.6)', fontSize: '12px', fontWeight: '500' }}>User</th>
                        <th style={{ padding: '12px 16px', textAlign: 'left', color: 'rgba(255,255,255,0.6)', fontSize: '12px', fontWeight: '500' }}>Email</th>
                        <th style={{ padding: '12px 16px', textAlign: 'right', color: 'rgba(255,255,255,0.6)', fontSize: '12px', fontWeight: '500' }}>Current Bonus</th>
                        <th style={{ padding: '12px 16px', textAlign: 'center', color: 'rgba(255,255,255,0.6)', fontSize: '12px', fontWeight: '500' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allUsers
                        .filter(user => (user.bonus || 0) > 0)
                        .filter(user => 
                          user.name?.toLowerCase().includes(bonusSearchTerm.toLowerCase()) ||
                          user.email?.toLowerCase().includes(bonusSearchTerm.toLowerCase()) ||
                          user.userName?.toLowerCase().includes(bonusSearchTerm.toLowerCase())
                        )
                        .map((user) => (
                        <tr key={user.idnum} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                          <td style={{ padding: '16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                              <div style={{
                                width: '40px',
                                height: '40px',
                                borderRadius: '50%',
                                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: '#fff',
                                fontWeight: 'bold'
                              }}>
                                {user.name?.charAt(0)?.toUpperCase() || user.email?.charAt(0)?.toUpperCase() || 'U'}
                              </div>
                              <div>
                                <div style={{ color: '#fff', fontWeight: '500' }}>{user.name || user.userName}</div>
                                <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '12px' }}>ID: {user.idnum}</div>
                              </div>
                            </div>
                          </td>
                          <td style={{ padding: '16px', color: '#fff' }}>{user.email}</td>
                          <td style={{ padding: '16px', textAlign: 'right', color: '#f59e0b', fontWeight: '600' }}>
                            ${user.bonus?.toLocaleString() || '0'}
                          </td>
                          <td style={{ padding: '16px', textAlign: 'center' }}>
                            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                              <button
                                onClick={() => handleAddBonusToUser(user)}
                                style={{
                                  padding: '0.375rem 0.75rem',
                                  background: 'rgba(16, 185, 129, 0.1)',
                                  color: '#10b981',
                                  border: '1px solid rgba(16, 185, 129, 0.3)',
                                  borderRadius: '6px',
                                  fontSize: '12px',
                                  cursor: 'pointer'
                                }}
                              >
                                <i className="icofont-plus"></i> Add
                              </button>
                              <button
                                onClick={() => handleRemoveBonusFromUser(user)}
                                style={{
                                  padding: '0.375rem 0.75rem',
                                  background: 'rgba(239, 68, 68, 0.1)',
                                  color: '#ef4444',
                                  border: '1px solid rgba(239, 68, 68, 0.3)',
                                  borderRadius: '6px',
                                  fontSize: '12px',
                                  cursor: 'pointer'
                                }}
                              >
                                <i className="icofont-minus"></i> Remove
                              </button>
                              <button
                                onClick={() => handleConvertBonusToBalance(user)}
                                style={{
                                  padding: '0.375rem 0.75rem',
                                  background: 'rgba(59, 130, 246, 0.1)',
                                  color: '#3b82f6',
                                  border: '1px solid rgba(59, 130, 246, 0.3)',
                                  borderRadius: '6px',
                                  fontSize: '12px',
                                  cursor: 'pointer'
                                }}
                              >
                                <i className="icofont-exchange"></i> Convert
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {allUsers.filter(user => (user.bonus || 0) > 0).length === 0 && (
                        <tr>
                          <td colSpan={4} style={{ padding: '40px', textAlign: 'center', color: 'rgba(255,255,255,0.6)' }}>
                            <i className="icofont-gift" style={{ fontSize: '48px', marginBottom: '16px', display: 'block', opacity: 0.3 }}></i>
                            No users have bonus yet
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* System Settings - Superadmin Only */}
          {activeTab === 'settings' && currentAdmin?.role === 'superadmin' && (
            <div className="page-section">
              <div className="page-header">
                <h2><i className="icofont-gear"></i> System Settings</h2>
                <span style={{
                  background: 'linear-gradient(135deg, rgba(139,92,246,0.2) 0%, rgba(59,130,246,0.2) 100%)',
                  color: '#a78bfa',
                  padding: '0.5rem 1rem',
                  borderRadius: '20px',
                  fontSize: '0.875rem',
                  fontWeight: 600
                }}>
                  <i className="icofont-crown"></i> Superadmin Only
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
                {/* User Role Management */}
                <div style={{
                  background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
                  borderRadius: '16px',
                  padding: '1.5rem',
                  border: '1px solid rgba(255,255,255,0.05)'
                }}>
                  <h3 style={{ color: '#f8fafc', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <i className="icofont-users-alt-5" style={{ color: '#f0b90b' }}></i>
                    Role Management
                  </h3>
                  <p style={{ color: '#94a3b8', fontSize: '0.875rem', marginBottom: '1rem' }}>
                    Promote users to admin or superadmin roles
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <select
                      style={{
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '8px',
                        padding: '0.75rem',
                        color: '#f8fafc',
                        fontSize: '0.875rem'
                      }}
                    >
                      <option value="">Select a user...</option>
                      {allUsers.map(user => (
                        <option key={user.idnum} value={user.idnum}>{user.userName || user.email}</option>
                      ))}
                    </select>
                    <select
                      style={{
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '8px',
                        padding: '0.75rem',
                        color: '#f8fafc',
                        fontSize: '0.875rem'
                      }}
                    >
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                      <option value="superadmin">Super Admin</option>
                    </select>
                    <button
                      style={{
                        padding: '0.75rem 1.5rem',
                        background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
                        border: 'none',
                        borderRadius: '8px',
                        color: '#fff',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                      onClick={() => showAlert('info', t('alerts.roleManagementComingSoonTitle'), t('alerts.roleManagementComingSoonMessage'))}
                    >
                      Update Role
                    </button>
                  </div>
                </div>

                {/* Admin Profile Settings */}
                <div style={{
                  background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
                  borderRadius: '16px',
                  padding: '1.5rem',
                  border: '1px solid rgba(255,255,255,0.05)'
                }}>
                  <h3 style={{ color: '#f8fafc', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <i className="icofont-user" style={{ color: '#f0b90b' }}></i>
                    Admin Profile
                  </h3>
                  <p style={{ color: '#94a3b8', fontSize: '0.875rem', marginBottom: '1rem' }}>
                    Customize your admin profile settings
                  </p>

                  {/* Current Avatar Display */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ color: '#94a3b8', fontSize: '0.875rem' }}>Current Avatar:</span>
                      {currentAdmin?.avatar ? (
                        <img 
                          src={`/images/${currentAdmin.avatar}.svg`} 
                          alt="Current Avatar"
                          style={{
                            width: '40px',
                            height: '40px',
                            borderRadius: '8px',
                            objectFit: 'cover',
                            border: '2px solid rgba(240, 185, 11, 0.3)'
                          }}
                        />
                      ) : (
                        <div style={{
                          width: '40px',
                          height: '40px',
                          borderRadius: '8px',
                          background: 'linear-gradient(135deg, #f0b90b 0%, #f8d12f 100%)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '1.25rem',
                          color: '#0f172a',
                          fontWeight: 700
                        }}>
                          👨‍💼
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Avatar Selection */}
                  <div>
                    <h4 style={{ color: '#f8fafc', fontSize: '0.875rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <i className="icofont-camera" style={{ color: '#f0b90b' }}></i>
                      Choose Avatar
                    </h4>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, 1fr)',
                      gap: '0.75rem',
                      maxWidth: '300px'
                    }}>
                      <div 
                        className={`avatar-option ${(currentAdmin?.avatar || 'avatar_male_1') === 'avatar_male_1' ? 'selected' : ''}`}
                        onClick={() => {
                          if (currentAdmin) {
                            const updatedAdmin = { ...currentAdmin, avatar: 'avatar_male_1' }
                            setCurrentAdmin(updatedAdmin)
                            localStorage.setItem('adminData', JSON.stringify(updatedAdmin))
                            localStorage.setItem('activeUser', JSON.stringify(updatedAdmin))
                            showAlert('success', t('alerts.avatarUpdatedTitle'), t('alerts.avatarUpdatedMessage'))
                          }
                        }}
                        style={{
                          cursor: 'pointer',
                          padding: '0.5rem',
                          border: (currentAdmin?.avatar || 'avatar_male_1') === 'avatar_male_1' ? '2px solid #f0b90b' : '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '8px',
                          background: (currentAdmin?.avatar || 'avatar_male_1') === 'avatar_male_1' ? 'rgba(240,185,11,0.1)' : 'rgba(255,255,255,0.03)',
                          transition: 'all 0.2s ease',
                          textAlign: 'center'
                        }}
                      >
                        <img src="/images/avatar_male_1.svg" alt="Male Avatar 1" style={{
                          width: '40px',
                          height: '40px',
                          borderRadius: '50%',
                          marginBottom: '0.25rem',
                          objectFit: 'cover'
                        }} />
                        <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Male 1</span>
                      </div>
                      <div 
                        className={`avatar-option ${currentAdmin?.avatar === 'avatar_male_2' ? 'selected' : ''}`}
                        onClick={() => {
                          if (currentAdmin) {
                            const updatedAdmin = { ...currentAdmin, avatar: 'avatar_male_2' }
                            setCurrentAdmin(updatedAdmin)
                            localStorage.setItem('adminData', JSON.stringify(updatedAdmin))
                            localStorage.setItem('activeUser', JSON.stringify(updatedAdmin))
                            showAlert('success', t('alerts.avatarUpdatedTitle'), t('alerts.avatarUpdatedMessage'))
                          }
                        }}
                        style={{
                          cursor: 'pointer',
                          padding: '0.5rem',
                          border: currentAdmin?.avatar === 'avatar_male_2' ? '2px solid #f0b90b' : '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '8px',
                          background: currentAdmin?.avatar === 'avatar_male_2' ? 'rgba(240,185,11,0.1)' : 'rgba(255,255,255,0.03)',
                          transition: 'all 0.2s ease',
                          textAlign: 'center'
                        }}
                      >
                        <img src="/images/avatar_male_2.svg" alt="Male Avatar 2" style={{
                          width: '40px',
                          height: '40px',
                          borderRadius: '50%',
                          marginBottom: '0.25rem',
                          objectFit: 'cover'
                        }} />
                        <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Male 2</span>
                      </div>
                      <div 
                        className={`avatar-option ${currentAdmin?.avatar === 'avatar_female_1' ? 'selected' : ''}`}
                        onClick={() => {
                          if (currentAdmin) {
                            const updatedAdmin = { ...currentAdmin, avatar: 'avatar_female_1' }
                            setCurrentAdmin(updatedAdmin)
                            localStorage.setItem('adminData', JSON.stringify(updatedAdmin))
                            localStorage.setItem('activeUser', JSON.stringify(updatedAdmin))
                            showAlert('success', t('alerts.avatarUpdatedTitle'), t('alerts.avatarUpdatedMessage'))
                          }
                        }}
                        style={{
                          cursor: 'pointer',
                          padding: '0.5rem',
                          border: currentAdmin?.avatar === 'avatar_female_1' ? '2px solid #f0b90b' : '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '8px',
                          background: currentAdmin?.avatar === 'avatar_female_1' ? 'rgba(240,185,11,0.1)' : 'rgba(255,255,255,0.03)',
                          transition: 'all 0.2s ease',
                          textAlign: 'center'
                        }}
                      >
                        <img src="/images/avatar_female_1.svg" alt="Female Avatar" style={{
                          width: '40px',
                          height: '40px',
                          borderRadius: '50%',
                          marginBottom: '0.25rem',
                          objectFit: 'cover'
                        }} />
                        <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Female</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* System Statistics */}
                <div style={{
                  background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
                  borderRadius: '16px',
                  padding: '1.5rem',
                  border: '1px solid rgba(255,255,255,0.05)'
                }}>
                  <h3 style={{ color: '#f8fafc', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <i className="icofont-chart-bar-graph" style={{ color: '#f0b90b' }}></i>
                    System Statistics
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <span style={{ color: '#94a3b8' }}>Total Users</span>
                      <span style={{ color: '#f8fafc', fontWeight: 600 }}>{allUsers.length}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <span style={{ color: '#94a3b8' }}>Admin Users</span>
                      <span style={{ color: '#f8fafc', fontWeight: 600 }}>{allUsers.filter(u => u.role === 'admin').length}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <span style={{ color: '#94a3b8' }}>Super Admins</span>
                      <span style={{ color: '#f8fafc', fontWeight: 600 }}>{allUsers.filter(u => u.role === 'superadmin').length}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0' }}>
                      <span style={{ color: '#94a3b8' }}>Total Investments</span>
                      <span style={{ color: '#f8fafc', fontWeight: 600 }}>{allInvestments.length}</span>
                    </div>
                  </div>
                </div>

                {/* Danger Zone */}
                <div style={{
                  background: 'linear-gradient(135deg, rgba(239,68,68,0.1) 0%, rgba(220,38,38,0.1) 100%)',
                  borderRadius: '16px',
                  padding: '1.5rem',
                  border: '1px solid rgba(239,68,68,0.3)'
                }}>
                  <h3 style={{ color: '#ef4444', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <i className="icofont-warning"></i>
                    Danger Zone
                  </h3>
                  <p style={{ color: '#f87171', fontSize: '0.875rem', marginBottom: '1rem' }}>
                    These actions are irreversible. Please proceed with caution.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <button
                      style={{
                        padding: '0.75rem 1.5rem',
                        background: 'transparent',
                        border: '1px solid rgba(239,68,68,0.5)',
                        borderRadius: '8px',
                        color: '#ef4444',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                      onClick={() => showConfirm(
                        t('confirm.clearPendingInvestmentsTitle'),
                        t('confirm.clearPendingInvestmentsMessage'),
                        () => {
                          setAllInvestments(prev => prev.map(inv => inv.status === 'Pending' ? { ...inv, status: 'Rejected' } : inv))
                            showAlert('warning', t('alerts.investmentsClearedTitle'), t('alerts.investmentsClearedMessage'))
                        }
                      )}
                    >
                      {t('buttons.clearPendingInvestments')}
                    </button>
                    <button
                      style={{
                        padding: '0.75rem 1.5rem',
                        background: 'transparent',
                        border: '1px solid rgba(239,68,68,0.5)',
                        borderRadius: '8px',
                        color: '#ef4444',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                      onClick={() => showConfirm(
                        t('confirm.clearPendingWithdrawalsTitle'),
                        t('confirm.clearPendingWithdrawalsMessage'),
                        () => {
                          setAllWithdrawals(prev => prev.map(w => w.status === 'Pending' ? { ...w, status: 'Rejected' } : w))
                          showAlert('warning', t('alerts.withdrawalsClearedTitle'), t('alerts.withdrawalsClearedMessage'))
                        }
                      )}
                    >
                      {t('buttons.clearPendingWithdrawals')}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Mobile Overlay */}
      {showSidePanel && (
        <div className="mobile-overlay" onClick={() => setShowSidePanel(false)}></div>
      )}

      {/* User Detail Modal */}
      {showUserModal && selectedUser && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.85)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
          backdropFilter: 'blur(8px)',
          padding: '1rem'
        }}>
          <div style={{
            background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
            borderRadius: '16px',
            maxWidth: '600px',
            width: '100%',
            maxHeight: '90vh',
            overflow: 'auto',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            border: '1px solid rgba(240,185,11,0.2)'
          }}>
            <div style={{
              padding: '1.5rem',
              borderBottom: '1px solid rgba(255,255,255,0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <h3 style={{ color: '#f8fafc', fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>
                User Details
              </h3>
              <button
                onClick={() => setShowUserModal(false)}
                style={{
                  background: 'rgba(255,255,255,0.1)',
                  border: 'none',
                  borderRadius: '8px',
                  width: '36px',
                  height: '36px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: '#f8fafc',
                  fontSize: '1.25rem'
                }}
              >
                ×
              </button>
            </div>
            <div style={{ padding: '2rem' }}>
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ color: '#94a3b8', fontSize: '0.75rem', display: 'block', marginBottom: '0.5rem' }}>User ID</label>
                <div style={{ color: '#f8fafc', fontSize: '1rem', fontWeight: 500 }}>{selectedUser.idnum}</div>
              </div>
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ color: '#94a3b8', fontSize: '0.75rem', display: 'block', marginBottom: '0.5rem' }}>Name</label>
                <div style={{ color: '#f8fafc', fontSize: '1rem', fontWeight: 500 }}>{selectedUser.name || selectedUser.userName}</div>
              </div>
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ color: '#94a3b8', fontSize: '0.75rem', display: 'block', marginBottom: '0.5rem' }}>Email</label>
                <div style={{ color: '#f8fafc', fontSize: '1rem', fontWeight: 500 }}>{selectedUser.email}</div>
              </div>
              
              {/* Balance Display and Update */}
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ color: '#94a3b8', fontSize: '0.75rem', display: 'block', marginBottom: '0.5rem' }}>Current Balance</label>
                <div style={{ color: '#10b981', fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                  ${(selectedUser.balance || 0).toLocaleString()}
                </div>
              </div>

              {/* Update Balance Section */}
              <div style={{ 
                background: 'rgba(240,185,11,0.05)', 
                border: '1px solid rgba(240,185,11,0.2)', 
                borderRadius: '12px', 
                padding: '1.5rem',
                marginBottom: '1.5rem'
              }}>
                <label style={{ 
                  color: '#f0b90b', 
                  fontSize: '0.875rem', 
                  fontWeight: 600, 
                  display: 'block', 
                  marginBottom: '0.75rem' 
                }}>
                  <i className="icofont-dollar"></i> Update Balance
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <input
                    type="number"
                    value={newBalance}
                    onChange={(e) => setNewBalance(e.target.value)}
                    placeholder="Enter new balance"
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '8px',
                      color: '#f8fafc',
                      fontSize: '0.875rem',
                      outline: 'none'
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = 'rgba(240,185,11,0.5)'
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'
                    }}
                  />
                  <input
                    type="text"
                    value={balanceUpdateReason}
                    onChange={(e) => setBalanceUpdateReason(e.target.value)}
                    placeholder="Reason for update (Required)"
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '8px',
                      color: '#f8fafc',
                      fontSize: '0.875rem',
                      outline: 'none'
                    }}
                  />
                  <button
                    onClick={handleUpdateUserBalance}
                    style={{
                      width: '100%',
                      padding: '0.75rem 1.5rem',
                      background: 'linear-gradient(135deg, #10b981 0%, #34d399 100%)',
                      border: 'none',
                      borderRadius: '8px',
                      color: '#fff',
                      fontSize: '0.875rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      transition: 'all 0.3s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'translateY(-2px)'
                      e.currentTarget.style.boxShadow = '0 4px 12px rgba(16,185,129,0.4)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)'
                      e.currentTarget.style.boxShadow = 'none'
                    }}
                  >
                    <i className="icofont-check"></i> Update
                  </button>
                </div>
              </div>

              <div style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '8px', padding: '1rem' }}>
                <small style={{ color: '#93c5fd', fontSize: '0.75rem' }}>
                  <i className="icofont-info-circle"></i> You can update user balance, view their transactions, and manage account settings directly from this panel.
                </small>
              </div>
            </div>
            <div style={{ padding: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={() => {
                  showConfirm(
                    t('confirm.deleteUserTitle'),
                    t('confirm.deleteUserMessage'),
                    () => {
                      if (selectedUser.idnum) {
                        handleDeleteUser(selectedUser.idnum);
                      }
                    },
                    () => {
                      // Cancelled
                    },
                    'Delete Account',
                    'Cancel'
                  );
                }}
                style={{
                  background: 'rgba(239,68,68,0.1)',
                  border: '1px solid rgba(239,68,68,0.3)',
                  borderRadius: '8px',
                  color: '#ef4444',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                <i className="icofont-trash"></i> {t('buttons.deleteUserAccount')}
              </button>
              <button
                onClick={() => setShowUserModal(false)}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  background: 'linear-gradient(135deg, #f0b90b 0%, #f8d12f 100%)',
                  border: 'none',
                  borderRadius: '8px',
                  color: '#0f172a',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Bonus Modal */}
      {showAddBonusModal && selectedBonusUser && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.85)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
          backdropFilter: 'blur(8px)',
          padding: '1rem'
        }}>
          <div style={{
            background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
            borderRadius: '16px',
            maxWidth: '500px',
            width: '100%',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            border: '1px solid rgba(245,158,11,0.2)'
          }}>
            <div style={{
              padding: '1.5rem',
              borderBottom: '1px solid rgba(255,255,255,0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <h3 style={{ color: '#f8fafc', fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>
                <i className="icofont-gift" style={{ marginRight: '0.5rem', color: '#f59e0b' }}></i>
                Add Bonus to {selectedBonusUser.name || selectedBonusUser.email}
              </h3>
              <button
                onClick={() => setShowAddBonusModal(false)}
                style={{
                  background: 'rgba(255,255,255,0.1)',
                  border: 'none',
                  borderRadius: '8px',
                  width: '36px',
                  height: '36px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: '#cbd5e1'
                }}
              >
                <i className="icofont-close"></i>
              </button>
            </div>

            <div style={{ padding: '1.5rem' }}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{
                  display: 'block',
                  color: '#f8fafc',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  marginBottom: '0.5rem'
                }}>
                  Current Bonus: <span style={{ color: '#f59e0b', fontWeight: 600 }}>${selectedBonusUser.bonus?.toLocaleString() || '0'}</span>
                  <br />
                  Current Balance: <span style={{ color: '#10b981', fontWeight: 600 }}>${selectedBonusUser.balance?.toLocaleString() || '0'}</span>
                </label>
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{
                  display: 'block',
                  color: '#f8fafc',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  marginBottom: '0.5rem'
                }}>
                  Add to:
                </label>
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#f8fafc', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="bonusType"
                      value="bonus"
                      checked={bonusType === 'bonus'}
                      onChange={(e) => setBonusType(e.target.value as 'bonus' | 'balance')}
                      style={{ accentColor: '#f59e0b' }}
                    />
                    Bonus (Promotional)
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#f8fafc', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="bonusType"
                      value="balance"
                      checked={bonusType === 'balance'}
                      onChange={(e) => setBonusType(e.target.value as 'bonus' | 'balance')}
                      style={{ accentColor: '#10b981' }}
                    />
                    Available Balance
                  </label>
                </div>
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{
                  display: 'block',
                  color: '#f8fafc',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  marginBottom: '0.5rem'
                }}>
                  Amount ($)
                </label>
                <input
                  type="number"
                  value={bonusAmount}
                  onChange={(e) => setBonusAmount(e.target.value)}
                  placeholder={`Enter ${bonusType} amount`}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    borderRadius: '8px',
                    border: '1px solid rgba(255,255,255,0.1)',
                    background: 'rgba(255,255,255,0.05)',
                    color: '#f8fafc',
                    fontSize: '0.875rem'
                  }}
                />
              </div>

              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{
                  display: 'block',
                  color: '#f8fafc',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  marginBottom: '0.5rem'
                }}>
                  Reason (Optional)
                </label>
                <textarea
                  value={bonusReason}
                  onChange={(e) => setBonusReason(e.target.value)}
                  placeholder="Enter reason for bonus..."
                  rows={3}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    borderRadius: '8px',
                    border: '1px solid rgba(255,255,255,0.1)',
                    background: 'rgba(255,255,255,0.05)',
                    color: '#f8fafc',
                    fontSize: '0.875rem',
                    resize: 'vertical'
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '1rem' }}>
                <button
                  onClick={() => {
                    setShowAddBonusModal(false)
                    setBonusType('bonus')
                  }}
                  style={{
                    flex: 1,
                    padding: '0.75rem',
                    background: 'rgba(255,255,255,0.1)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    borderRadius: '8px',
                    color: '#cbd5e1',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmAddBonus}
                  disabled={!bonusAmount || parseFloat(bonusAmount) <= 0}
                  style={{
                    flex: 1,
                    padding: '0.75rem',
                    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#0f172a',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    cursor: (!bonusAmount || parseFloat(bonusAmount) <= 0) ? 'not-allowed' : 'pointer',
                    opacity: (!bonusAmount || parseFloat(bonusAmount) <= 0) ? 0.5 : 1
                  }}
                >
                  <i className="icofont-plus" style={{ marginRight: '0.5rem' }}></i>
                  Add Bonus
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmModal.show && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.75)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 99998,
          animation: 'fadeIn 0.3s ease-out'
        }}>
          <div style={{
            background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
            borderRadius: '16px',
            padding: '1.5rem',
            maxWidth: '400px',
            width: '90%',
            boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
            border: '1px solid rgba(255,255,255,0.05)'
          }}>
            <div style={{
              textAlign: 'center',
              marginBottom: '2rem'
            }}>
              <div style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 1rem',
                boxShadow: '0 8px 20px rgba(245,158,11,0.3)'
              }}>
                <i className="icofont-warning" style={{ fontSize: '2rem', color: '#fff' }}></i>
              </div>
              <h2 style={{
                color: '#f8fafc',
                fontSize: '1.5rem',
                fontWeight: 700,
                margin: '0 0 1rem 0'
              }}>
                {confirmModal.title}
              </h2>
              <p style={{
                color: '#cbd5e1',
                fontSize: '1rem',
                lineHeight: '1.6',
                margin: 0
              }}>
                {confirmModal.message}
              </p>
            </div>

            <div style={{
              display: 'flex',
              gap: '1rem'
            }}>
              <button
                onClick={() => {
                  confirmModal.onConfirm()
                  closeConfirm()
                }}
                style={{
                  flex: 1,
                  padding: '1rem',
                  background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                  border: 'none',
                  borderRadius: '12px',
                  color: '#fff',
                  fontSize: '1rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: '0 8px 20px rgba(239,68,68,0.3)',
                  transition: 'all 0.3s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)'
                  e.currentTarget.style.boxShadow = '0 12px 30px rgba(239,68,68,0.4)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)'
                  e.currentTarget.style.boxShadow = '0 8px 20px rgba(239,68,68,0.3)'
                }}
              >
                {confirmModal.confirmText}
              </button>
              <button
                onClick={() => {
                  if (confirmModal.onCancel) confirmModal.onCancel()
                  closeConfirm()
                }}
                style={{
                  flex: 1,
                  padding: '1rem',
                  background: 'rgba(255,255,255,0.1)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: '12px',
                  color: '#cbd5e1',
                  fontSize: '1rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.3s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.2)'
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'
                }}
              >
                {confirmModal.cancelText}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Alert System */}
      {modalAlert.show && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.75)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 999999,
          animation: 'fadeIn 0.3s ease-out'
        }}>
          <div style={{
            background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
            borderRadius: '16px',
            padding: '1.5rem',
            maxWidth: '400px',
            width: '90%',
            boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
            border: '1px solid rgba(255,255,255,0.05)'
          }}>
            <div style={{
              textAlign: 'center',
              marginBottom: '2rem'
            }}>
              <div style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                background: modalAlert.type === 'success' ? 'linear-gradient(135deg, #10b981 0%, #34d399 100%)' :
                         modalAlert.type === 'error' ? 'linear-gradient(135deg, #ef4444 0%, #f87171 100%)' :
                         modalAlert.type === 'warning' ? 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)' :
                         'linear-gradient(135deg, #3b82f6 0%, #60a5fa 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 1rem',
                boxShadow: modalAlert.type === 'success' ? '0 8px 20px rgba(16,185,129,0.3)' :
                          modalAlert.type === 'error' ? '0 8px 20px rgba(239,68,68,0.3)' :
                          modalAlert.type === 'warning' ? '0 8px 20px rgba(245,158,11,0.3)' :
                          '0 8px 20px rgba(59,130,246,0.3)'
              }}>
                <i className={
                  modalAlert.type === 'success' ? 'icofont-check-circled' :
                  modalAlert.type === 'error' ? 'icofont-close-circled' :
                  modalAlert.type === 'warning' ? 'icofont-warning' :
                  'icofont-info-circle'
                } style={{ fontSize: '2rem', color: '#fff' }}></i>
              </div>
              <h2 style={{
                color: '#f8fafc',
                fontSize: '1.5rem',
                fontWeight: 700,
                margin: '0 0 1rem 0'
              }}>
                {modalAlert.title}
              </h2>
              <p style={{
                color: '#cbd5e1',
                fontSize: '1rem',
                lineHeight: '1.6',
                margin: 0
              }}>
                {modalAlert.message}
              </p>
            </div>

            <button
              onClick={closeAlert}
              style={{
                width: '100%',
                padding: '1rem',
                background: modalAlert.type === 'success' ? 'linear-gradient(135deg, #10b981 0%, #34d399 100%)' :
                         modalAlert.type === 'error' ? 'linear-gradient(135deg, #ef4444 0%, #f87171 100%)' :
                         modalAlert.type === 'warning' ? 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)' :
                         'linear-gradient(135deg, #3b82f6 0%, #60a5fa 100%)',
                border: 'none',
                borderRadius: '12px',
                color: '#fff',
                fontSize: '1rem',
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: modalAlert.type === 'success' ? '0 8px 20px rgba(16,185,129,0.3)' :
                          modalAlert.type === 'error' ? '0 8px 20px rgba(239,68,68,0.3)' :
                          modalAlert.type === 'warning' ? '0 8px 20px rgba(245,158,11,0.3)' :
                          '0 8px 20px rgba(59,130,246,0.3)',
                transition: 'all 0.3s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)'
                e.currentTarget.style.boxShadow = modalAlert.type === 'success' ? '0 12px 30px rgba(16,185,129,0.4)' :
                                                modalAlert.type === 'error' ? '0 12px 30px rgba(239,68,68,0.4)' :
                                                modalAlert.type === 'warning' ? '0 12px 30px rgba(245,158,11,0.4)' :
                                                '0 12px 30px rgba(59,130,246,0.4)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)'
                e.currentTarget.style.boxShadow = modalAlert.type === 'success' ? '0 8px 20px rgba(16,185,129,0.3)' :
                                                modalAlert.type === 'error' ? '0 8px 20px rgba(239,68,68,0.3)' :
                                                modalAlert.type === 'warning' ? '0 8px 20px rgba(245,158,11,0.3)' :
                                                '0 8px 20px rgba(59,130,246,0.3)'
              }}
            >
              {modalAlert.type === 'success' ? 'Great!' : 'Got it'}
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  )
}

export default AdminDashboard
