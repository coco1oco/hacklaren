# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- MARA MVP: React + Vite PWA (Vercel) with Firebase Auth/Firestore/Functions (asia-southeast1).
- Patient registration with duplicate detection and consent, visits (offline, durable outbox), trends, risk flags.
- Emergency referrals (immediate send, async AI summary, SMS, offline queue) and checkup referrals (AI summary review gate).
- Token-gated hospital view (hashed, expiring, revocable links; rate limited) with acknowledge / decline / arrived.
- Server-side PDF export, audit logs, count-only reporting, admin (staff, clinics, hospitals).
- Mock AI SummaryProvider and mock/Semaphore SMS providers.
- Firestore rules tests, unit tests, and Playwright E2E.
