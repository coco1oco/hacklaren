# Silang

A digital maternal record and referral transfer system for Philippine lying-in clinics and receiving hospitals.

## Overview

Small, community-level lying-in clinics often keep maternal and prenatal information on paper. When a patient is referred to a hospital, the referral usually communicates the immediate reason but not the patient's longitudinal prenatal history, leaving the receiving clinician to reconstruct it from incomplete information.

Silang makes the documented maternal record transferable as a structured digital referral.

> **Record once at the referring clinic, transfer the documented history securely, and help the receiving clinician understand it quickly.**

Silang is an information-transfer and record-management system. It is **not a diagnostic or clinical decision-making system** — the clinician remains responsible for clinical assessment and decisions.

## Tech Stack

| Layer                  | Technology                                        |
| ---------------------- | ------------------------------------------------- |
| Frontend               | Expo React / React Native                         |
| Database               | Firebase (Firestore / Auth / Storage)             |
| Backend                | Silang backend/API layer (maintained by backend team) |
| AI / Orchestration     | Amazon Quick                                      |
| SMS                    | AWS SNS or the team's existing SMS implementation |
| Dev Environment        | Kiro                                              |

## Architecture

```text
Frontend (Expo React)
      │
      ▼
Silang Backend / API  ──►  Firebase


AI / Orchestration (Amazon Quick)
      │
      ▼
Silang Backend / API  ──►  Firebase


Notifications
Silang Backend  ──►  AWS SNS / existing SMS service
```

### Key architectural rules

- **Do not replace Firebase.** Firebase is the project's database.
- **Amazon Quick is the AI/workflow layer, not the database.** It summarizes documented information only.
- **Amazon Quick must not connect directly to Firebase.** Use `Amazon Quick → Silang REST API → Firebase`, never Firebase credentials directly.
- **The frontend is not responsible for security.** Authorization and sensitive data access are enforced by the backend. A referral ID alone is not sufficient authorization for sensitive production data.

## Prerequisites

- [Node.js](https://nodejs.org/) (LTS version recommended)
- npm or yarn
- [Expo CLI](https://docs.expo.dev/more/expo-cli/) (bundled via `npx expo`)
- For device testing: the [Expo Go](https://expo.dev/go) app, or an iOS Simulator / Android Emulator

## Getting Started

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npx expo start
```

From the Expo CLI you can then:

- Press `a` to open on an Android emulator
- Press `i` to open on an iOS simulator
- Press `w` to open in a web browser
- Scan the QR code with Expo Go on a physical device

## Project Scope

The project is divided into implementation phases. The hackathon MVP covers Phases 1–6; Phase 7 is optional.

| Phase | Name                      | Description                                                       |
| ----- | ------------------------- | ----------------------------------------------------------------- |
| 1     | Core Maternal Record      | Digital maternal record (patient, pregnancy, prenatal visits)     |
| 2     | Referral Creation         | Create a referral from an existing maternal record                |
| 3     | Referral Data Package     | Controlled, referral-specific representation of patient data      |
| 4     | Hospital Referral Access  | Receiving-facility view of the referral                           |
| 5     | Amazon Quick AI Summary   | Constrained, non-diagnostic clinician-facing summary              |
| 6     | Family SMS                | Minimal referral notification to the family                       |
| 7     | Referral Status Tracking  | `CREATED → SENT → RECEIVED → IN REVIEW → COMPLETED` (optional)     |

Future roadmap (not required for MVP): hospital outcome feedback, offline-first sync, and broader health-system integration (LGU/MHO, DOH, PhilHealth).

### MVP end-to-end flow

```text
Midwife records prenatal information
  → creates a referral
  → receiving hospital opens the referral
  → Amazon Quick retrieves the documented history
  → generates a concise non-diagnostic summary
  → saves it
  → hospital sees the summary
  → family receives an SMS
```

## AI Safety Constraints

The Amazon Quick AI summary must use **only information explicitly present in the retrieved Silang record**. It must **not** diagnose, infer diseases/complications/risk, recommend treatment or medication, predict outcomes, invent or estimate missing values, alter the original record, or access another patient's data.

- Missing fields are rendered as `Not documented`.
- The exact documented referral reason must be preserved.
- Every summary must state that it is an AI-generated summary of documented records and is not a diagnosis or treatment recommendation.

## Security Requirements

- Authentication, authorization, and referral-specific access enforced server-side
- HTTPS and server-side validation
- No cross-patient access; read-only hospital access where appropriate
- Minimal information in SMS
- **No secrets in frontend code and none committed to Git** (Firebase service-account JSON, private keys, database credentials, production secrets, private API keys)
- Audit timestamps for referral events

## Project Structure

```text
Silang/
├── app/              # Application screens and routes (expo-router)
├── assets/           # Images, fonts, and other static assets
├── components/       # Reusable UI components
├── constants/        # App-wide constants and theme values
├── hooks/            # Custom React hooks
├── app.json          # Expo app configuration
├── package.json      # Dependencies and scripts
└── tsconfig.json     # TypeScript configuration
```

## Available Scripts

| Script            | Description                          |
| ----------------- | ------------------------------------ |
| `npm start`       | Start the Expo development server    |
| `npm run android` | Start and open on Android            |
| `npm run ios`     | Start and open on iOS                |
| `npm run web`     | Start and open in the browser        |
| `npm run lint`    | Run the linter                       |

## Demo Data

Use **synthetic data only**. Do not use real patient information in the hackathon demo.

- Suggested demo identifier: `REF-DEMO-001`
- Suggested demo patient: `Maria Santos`

## Documentation

- [Handoff / Project Spec](./HANDOFF.md)
- [Contributing Guide](./CONTRIBUTING.md)
- [Changelog](./CHANGELOG.md)

## License

See [LICENSE](./LICENSE).
