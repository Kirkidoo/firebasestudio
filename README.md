# ShopSync Auditor

ShopSync Auditor is a powerful tool designed to bridge the gap between supplier data (via FTP/CSV) and your Shopify store. It automates the process of auditing product data, identifying discrepancies in price, inventory, and product existence.

## Features

- **Secure FTP Connection**: Connects securely to supplier FTP servers to retrieve product data.
- **Intelligent CSV Parsing**: Reads and processes large CSV files containing supplier product information.
- **Shopify Integration**: Fetches real-time product data from your Shopify store using the Admin API.
- **Automated Auditing**: Compares supplier data against Shopify data to identify:
  - **Matches**: Products that are in sync.
  - **Mismatches**: Discrepancies in Price, Inventory, etc.
  - **Missing in Shopify**: New products available from the supplier.
  - **Not in CSV**: Products in Shopify that are no longer in the supplier feed.
- **Interactive Reports**: View audit results in a clean, filterable table.
- **Exportable Data**: Download audit reports for offline analysis.

## Tech Stack

- **Framework**: [Next.js 15](https://nextjs.org/) (App Router)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **UI Components**: [Radix UI](https://www.radix-ui.com/) & [Lucide React](https://lucide.dev/)
- **Backend/Serverless**: [Firebase](https://firebase.google.com/) (Genkit)
- **Testing**: [Jest](https://jestjs.io/) & [React Testing Library](https://testing-library.com/)

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- A Shopify Store (for API credentials)
- Firebase project (optional, for deployment)

### Installation

1.  Clone the repository:

    ```bash
    git clone <repository-url>
    cd firebasestudio
    ```

2.  Install dependencies:

    ```bash
    npm install
    ```

3.  Set up environment variables:
    Create a `.env.local` file in the root directory and add your Shopify and other secrets (see `.env.example` if available, or ask the team).

### Running Locally

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

### Scripts

- `npm run dev`: Starts the Next.js development server.
- `npm run build`: Builds the application for production.
- `npm start`: Starts the production server.
- `npm run lint`: Runs ESLint to check for code quality issues.
- `npm test`: Runs the Jest test suite.
