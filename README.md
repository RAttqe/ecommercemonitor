# E-Commerce AI Monitor 🚀

A full-stack B2B automated monitoring platform designed for e-commerce businesses. This system continuously tracks website health, performance, and conversion funnels using AI-driven end-to-end (E2E) testing.

## ⚙️ Core Features
*   **AI-Powered E2E Testing:** Uses Google Gemini AI to dynamically detect and interact with Call-to-Action (CTA) buttons (e.g., "Add to Cart", "Checkout") to ensure conversion funnels are fully operational.
*   **Visual & Performance Audits:** Measures page load times, SSL certificate validity, and identifies broken or slow-loading images via Playwright.
*   **Asynchronous Queues:** Implements robust task scheduling and background processing using BullMQ and Redis to handle concurrent site checks efficiently.
*   **Real-time Alerts:** Integrated Telegram Bot interface (via Telegraf) for instant notifications, error reporting (including AI analysis of error screenshots), and user management.

## 🛠 Tech Stack
*   **Frontend:** React, TypeScript
*   **Backend:** Node.js, TypeScript
*   **Database & ORM:** PostgreSQL, Prisma
*   **Infrastructure & Queues:** Docker, Redis, BullMQ
*   **Automation & AI:** Playwright (with stealth plugins), Google Generative AI (Gemini)
