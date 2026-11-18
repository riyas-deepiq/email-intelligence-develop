import React from 'react';
import { BRAND_NAME } from '@/shared/brand';
import styles from '@/styles/features/marketing/pages/Contact.module.css';

export function Contact() {
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const subject = encodeURIComponent(`${BRAND_NAME} enquiry from ${String(form.get('name') ?? '')}`);
    const body = encodeURIComponent(
      `Name: ${String(form.get('name') ?? '')}\nEmail: ${String(form.get('email') ?? '')}\n\n${String(form.get('message') ?? '')}`,
    );
    const supportEmail = import.meta.env.VITE_SUPPORT_EMAIL ?? 'support@insight-hub.local';
    window.location.href = `mailto:${supportEmail}?subject=${subject}&body=${body}`;
  };

  return (
    <div className={styles.container}>
      <h1>Contact Us</h1>
      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.group}>
          <label htmlFor="name">Name:</label>
          <input type="text" id="name" name="name" required />
        </div>
        <div className={styles.group}>
          <label htmlFor="email">Email:</label>
          <input type="email" id="email" name="email" required />
        </div>
        <div className={styles.group}>
          <label htmlFor="message">Message:</label>
          <textarea id="message" name="message" rows={5} required />
        </div>
        <button type="submit" className={styles.btn}>
          Send Message
        </button>
      </form>
    </div>
  );
}
