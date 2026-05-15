import { useRef, useState } from 'react'

function Contact() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    subject: '',
    message: ''
  })
  const [status, setStatus] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const submitInFlightRef = useRef(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitInFlightRef.current) return
    submitInFlightRef.current = true
    setIsSubmitting(true)
    setStatus('Sending...')
    
    // Simulate form submission
    setTimeout(() => {
      setStatus('Message sent successfully! We\'ll get back to you within 2 business days.')
      setFormData({ name: '', email: '', subject: '', message: '' })
      submitInFlightRef.current = false
      setIsSubmitting(false)
    }, 1000)
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    })
  }

  return (
    <div className="contact-page">
      <div className="contact-page__container">
        <h1>Contact Us</h1>
        <p className="lead">
          Have a question or need support? Fill the form below and we'll get back to you within 2 business days.
        </p>

        <form onSubmit={handleSubmit} className="contact-form">
          <div className="form__group">
            <label htmlFor="name">Full name</label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleChange}
              placeholder="Your full name"
            />
          </div>

          <div className="form__group">
            <label htmlFor="email">Email address</label>
            <input
              type="email"
              id="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="you@example.com"
              required
            />
          </div>

          <div className="form__group">
            <label htmlFor="subject">Subject</label>
            <input
              type="text"
              id="subject"
              name="subject"
              value={formData.subject}
              onChange={handleChange}
              placeholder="What is this about?"
            />
          </div>

          <div className="form__group">
            <label htmlFor="message">Message</label>
            <textarea
              id="message"
              name="message"
              value={formData.message}
              onChange={handleChange}
              rows={6}
              placeholder="Write your message here..."
            />
          </div>

          <div className="contact-form__footer">
            <button type="submit" className="btn btn--primary" disabled={isSubmitting}>
              {isSubmitting ? 'Sending...' : 'Send Message'}
            </button>
            <small className="contact-form__email">
              Use this form and our team will reply through the contact details you provide.
            </small>
          </div>

          {status && <p className="form__status">{status}</p>}
        </form>
      </div>
    </div>
  )
}

export default Contact
