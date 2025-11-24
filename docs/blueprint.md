# **App Name**: ShopSync Auditor

## Core Features:

- FTP Connection: Securely connect to an FTP server using provided credentials.
- CSV Import: Select and read a CSV file containing product data from the connected FTP server.
- Shopify Data Sync: Fetch product data from Shopify using SKUs from the CSV file. Rate-limiting is enabled to avoid stressing the connection to the shop.
- Audit Report Generation: Generate an audit report that compares the data between the CSV file and Shopify, identifying matches, mismatches, and new products.
- Report Display: Display the audit report in a clear, tabular format. Highlighting matching, mismatched, and new products. UI will need filtering to aid the user.
- Report Download: Provide a download option for the generated audit report in CSV format.

## Style Guidelines:

- Primary color: HSL values of 210, 75%, 50% which converts to a bright, saturated blue (#2694F2), for clarity and trustworthiness in handling sensitive data.
- Background color: HSL values of 210, 20%, 95% which converts to a very light blue (#F0F6FA). This provides a clean, unobtrusive background.
- Accent color: HSL values of 180, 60%, 40% which converts to a teal (#3DB7AD). This provides a pop of contrast and draws the eye to key actionable elements without distracting.
- Body and headline font: 'Inter', a sans-serif font, will be used for both body text and headlines due to its modern, neutral, and readable design.
- Use simple, consistent icons to represent different product statuses (match, mismatch, new) and actions (download, connect, etc.).
- Employ a clean, tabular layout for the audit report, with clear column headers and easily distinguishable rows. Use visual cues to highlight mismatches and new products.
- Incorporate subtle animations (e.g., progress bars) during the FTP connection, CSV parsing, and data fetching processes to provide user feedback.
