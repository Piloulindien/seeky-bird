# Seeky Bird

**Seeky Bird** is a mobile-first skill-based arcade game built for the **Solana Mobile Hackathon**.

Players compete in short Flappy-Bird style runs.
Each run can be free or paid, and paid runs contribute to a **shared prize pool** distributed to the best players.

The game runs inside a **Solana Mobile WebView**, allowing direct wallet interaction from the device.

---

## Gameplay

Seeky Bird is simple to play but difficult to master.

* Tap to keep the bird flying
* Avoid the pipes
* Each pipe passed = **+1 score**
* The best scores enter the **leaderboard**

Players can participate in three modes:

### Normal mode

* Paid runs contribute to a **round-based pool**
* Top 10 players share the reward

### Daily mode

* A daily leaderboard
* The best scores compete for the daily pool

### SuperPrize mode

* Special high-stakes pool
* Top 3 players win

---

## Solana Integration

Seeky Bird integrates several Solana features:

* **Wallet connection via Solana Mobile Wallet Adapter**
* **On-chain payment for runs**
* **Transaction signature verification**
* **Deterministic gameplay seed**
* **Server-verified leaderboard submission**

Runs are purchased using a transaction signed directly from the mobile wallet.

---

## Tech Stack

* **Phaser** — game engine
* **Next.js** — web + API backend
* **React Native** — mobile wrapper
* **Solana Web3.js**
* **Solana Mobile Wallet Adapter**

---

## Project Structure

```
seeky-bird/
 ├── src/game        # Phaser gameplay
 ├── src/server      # backend logic
 ├── src/app         # Next.js routes
 └── api             # leaderboard and runs API

seeky-bird-mobile/
 └── React Native wrapper embedding the game
```

---

## Running the project

### Web server

```bash
npm install
npm run dev
```

Server runs on:

```
http://localhost:3000
```

### Mobile app

```
cd seeky-bird-mobile
npm install
npm run android
```

---

## Hackathon Focus

This project explores a new type of **skill-based on-chain arcade experience**:

* fast gameplay
* transparent rewards
* mobile-native wallet interaction

The goal is to demonstrate how **Solana Mobile can enable competitive Web3 games that feel like traditional mobile games**.

---

## Author

Pierre-Louis Le Roux
