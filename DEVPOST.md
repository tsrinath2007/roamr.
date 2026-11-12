# ROAMR — Devpost Submission & Demo Script

## Inspiration / The Problem
Local independent cafés, indie bookshops, museums, and neighborhood spots struggle to compete with paid social ads that burn budget on impressions without guaranteeing real-world foot traffic. Meanwhile, travelers and locals want authentic neighborhood discovery instead of generic tourist checklists.

## What It Does (The Solution)
**ROAMR** turns neighborhood discovery into real-world quests backed by AI verification and instant PayPal payouts:
1. **Businesses** create a local quest (e.g., *"Visit The Bean Trail Café and snap a photo or receipt"*) and pre-fund a USD budget using **PayPal Orders**.
2. **Travelers** personalize quests by interest (`food`, `history`, `nature`, `photography`, `nightlife`) with **Gemini AI**, explore nearby spots on an interactive map, and upload photo or receipt proof via their phone camera.
3. **Gemini Vision AI** evaluates the photo against the venue and quest objective.
4. Once verified, ROAMR dispatches the traveler's USD reward via **PayPal Payouts** and stamps their digital travel passport with an animated ink stamp.

## How PayPal Is Used (Specific APIs)
ROAMR integrates two official **PayPal REST APIs** in `/server/src/services/paypalService.js` against `https://api-m.sandbox.paypal.com`:
- **PayPal OAuth 2.0 (`POST /v1/oauth2/token`)**: Authenticates server-side requests using `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`.
- **PayPal Orders v2 (`POST /v2/checkout/orders` & `POST /v2/checkout/orders/{orderId}/capture`)**: Powers the Business Quest Funding flow (`/api/quests/fund`). When live sandbox credentials are present, the app opens PayPal's `approve` link via `expo-web-browser` and captures the escrowed budget on confirmation.
- **PayPal Payouts v1 (`POST /v1/payments/payouts` & `GET /v1/payments/payouts/{batchId}`)**: Triggered by `/api/payouts` *only after* Gemini AI verification returns `verified: true`, sending the USD reward to the traveler's PayPal sandbox email and exposing live status checks in the Wallet screen.
- **Honest Transparency on Sandbox Fallbacks**: If PayPal sandbox credentials are absent—or if a sandbox developer account does not yet have the Payouts permission enabled—the server logs the exact PayPal response and cleanly marks the transaction with `simulated: true` / `SIMULATED_SUCCESS` in the UI.

## How AI Is Used
Using Google's **Gemini API (`gemini-2.5-flash`)** in `/server/src/services/geminiService.js`:
1. **Multimodal Proof Verification (`POST /api/verify`)**: Evaluates the traveler's uploaded camera photo or receipt against the business name and quest objective, returning structured JSON (`verified`, `confidence`, `reason`).
2. **Personalized Quest Generation (`POST /api/quests/generate`)**: Takes the traveler's selected interests and city plus funded local businesses to generate 3 story-style *"Recommended for you"* quests.
3. **Business Weekly Insights (`POST /api/business/insight`)**: Summarizes verified visits, total spend, and cost per visit into two concise sentences of actionable growth advice on the Business Dashboard.
*(Includes deterministic mock fallbacks when `GEMINI_API_KEY` is omitted so demos never stall offline.)*

## Challenges We Ran Into
- **Mobile-to-Localhost Networking**: Phones running Expo Go cannot reach `localhost`, requiring `EXPO_PUBLIC_API_URL` bound to the host machine's LAN IP and Express listening on `0.0.0.0`.
- **3D Mapbox Globe Inside Expo Go**: `@rnmapbox/maps` requires custom native code unavailable in standard Expo Go, so we built a 3D interactive globe (`mapbox://styles/mapbox/standard`, `projection: "globe"`, atmosphere/stars, `day`/`dusk` presets, 3D city buildings, city & quest pins) using **Mapbox GL JS v3** inside `react-native-webview` with a 2-way `postMessage` bridge—preserving 1-scan Expo Go testing and full web parity.
- **PayPal Payouts Sandbox Permissions**: Handling sandbox accounts without Payouts enabled gracefully with transparent logging and clearly labeled fallback states.

## What's Next
- Persistent PostgreSQL database + user authentication for businesses and travelers.
- GPS geofencing + receipt OCR anti-fraud checks combined with Gemini Vision.
- Multi-stop neighborhood trails and neighborhood-pass bundles funded by city tourism boards.

---

## 3-Minute Demo Video Script (With Timestamps)

- **0:00 – 0:25 | The Hook & Problem**
  - Show the ROAMR Map screen on a real phone via Expo Go.
  - *"Local businesses spend thousands on ad clicks that never walk through the door. ROAMR flips that: businesses only pay when Gemini AI verifies a real visit, and travelers get paid instantly via PayPal."*
- **0:25 – 0:55 | AI Personalization & Map Discovery**
  - Open **Profile -> Personalize Quests with AI** (`/onboarding`), pick *Food & Cafés* + *Photography*, tap **Generate My Quests**.
  - Return to **Map**, point out the *"Recommended for you"* strip, toggle **Live GPS / Illustrated** map, tap **The Bean Trail Café** pin, and tap **Start Quest**.
- **0:55 – 1:40 | Quest Detail, Camera Proof & Gemini Verification**
  - Walk through **Quest Detail** (`$5.00 USD`, `+50 XP`, *"Funded by The Bean Trail Café"*).
  - Tap **Submit Proof**, capture/select a photo (or show Demo Mode sample), tap **Verify with AI**.
  - Show *"Checking your photo..."* -> **Proof Verified!** with Gemini's plain-language reason and confidence score.
- **1:40 – 2:15 | Animated Passport Stamp & PayPal Wallet**
  - Tap **Claim +50 XP & $5.00** -> land on **Quest Completed!** with the rotating/stamping ink **ROAMR EXPLORED** passport stamp and split `+50 XP | PayPal $5.00` card.
  - Tap **View Wallet** to show the updated USD balance, PayPal payout batch status, and switch to **Collection** to show the stamp grid.
- **2:15 – 2:50 | Business Portal & PayPal Orders Funding**
  - Tap the **Business** toggle in the header -> show **Verified Visits**, **Money Spent**, **Cost / Visit**, and the **Gemini Weekly Insight** card.
  - Tap **Create & Fund New Quest**, enter a café quest (`$5` reward, `$50` budget), and tap **Fund $50.00 with PayPal** (showing the PayPal Sandbox Order / simulated fallback status cleanly).
- **2:50 – 3:00 | Closing**
  - *"That's ROAMR: Gemini-verified foot traffic, instant PayPal Payouts, and neighborhood exploration that pays for itself."*
