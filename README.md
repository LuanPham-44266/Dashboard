# ERP Sales & Invoicing Dashboard

A mini Enterprise Resource Planning (ERP) system built with Node.js, Express, PostgreSQL, and Vanilla JavaScript (Tabler UI). This application streamlines the sales process with strict Role-Based Access Control (RBAC) separating the Sales and Accounting departments to ensure financial security and workflow integrity.

## Key Features

- **Sales Order Management:** Create quotations, update sales status, and manage customer orders.
- **Invoicing & Payments:** Generate invoices, register payments, and export invoices as PDF files.
- **Role-Based Access Control (RBAC):**
  - `Sale`: Manages orders and closes sales. Restricted from financial/invoicing actions.
  - `Accountant`: Manages invoices, confirms payments, and views revenue reports.
  - `Manager`: Full administrative access to all features.
- **Reporting & Analytics:** Real-time revenue tracking and order statistics.
- **Data Import/Export:** Seamlessly process product and order data via Excel files (powered by `exceljs`).

## Prerequisites

To run this project locally, ensure you have the following installed on your machine:

- **Node.js** (v18.x or v20.x LTS recommended)
- **PostgreSQL** (v12 or higher)
- **Git**

## Local Setup Guide (Windows & Linux)

### Step 1: Clone the Repository

Open your terminal (Linux/macOS) or PowerShell/Git Bash (Windows) and run:

```bash
# Clone the repository
git clone https://github.com/LuanPham-44266/Dashboard.git

# Navigate to the project directory
cd Dashboard/sales-dashboard

# Install dependencies
npm install
```

### Step 2: Database Configuration

1. **Create the Database:**

You can use GUI tools like pgAdmin/DBeaver, or execute via Command Line:

- **On Linux (Ubuntu/Arch):**
  ```bash
  sudo -u postgres psql -c "CREATE DATABASE sale_db;"
  ```

- **On Windows (cmd/PowerShell):**
  ```bash
  psql -U postgres -c "CREATE DATABASE sale_db;"
  ```

2. **Initialize Schema and Seed Data:**
Run the `init.sql` script to create tables, and use your seed file to populate initial data.

```bash
# Linux
sudo -u postgres psql -d sale_db -f init.sql

# Windows
psql -U postgres -d sale_db -f init.sql
```

### Step 3: Environment Variables

Create a `.env` file in the root directory (`sales-dashboard`) next to `server.js` and add the following configurations:

```env
# Server Port
PORT=3000

# Local Database Configuration
DB_USER=postgres
DB_HOST=localhost
DB_NAME=sale_db
DB_PASSWORD=1234
DB_PORT=5432

# (Optional) If using a single connection string:
# DATABASE_URL=postgresql://postgres:1234@localhost:5432/sale_db

# JWT Secret Key (Required for authentication)
JWT_SECRET=supersecretkey_erp_luanpham
```

### Step 4: PDF Font Configuration

To prevent 500 Internal Server Errors when generating PDFs (especially on Linux environments lacking default system fonts):

1. Create a folder named `fonts` in the same directory as `server.js`.
2. Download and place a TrueType Font file (e.g., `Roboto-Regular.ttf` or `Arial.ttf`) inside the `fonts` folder.

### Step 5: Start the Application

```bash
# Run in development mode (auto-reloads on file changes)
npm run dev

# OR run in standard mode
npm start
```

Once the terminal displays `Server running on port 3000`, open your browser and navigate to: **http://localhost:3000**

## Test Accounts (Seed Data)

Use these credentials to test the RBAC implementation:

| Role | Email | Password | Permissions |
| :--- | :--- | :--- | :--- |
| **Manager** | `manager@erp.com` | `123456` | Full system access. |
| **Sale** | `sale@erp.com` | `123456` | Create/Confirm orders. Cannot generate invoices. |
| **Accountant** | `accountant@erp.com` | `123456` | Create/Confirm invoices, register payments, view reports. |

## Business Flow Demo (Standard Procedure)

To demonstrate the intended business logic (Segregation of Duties):

1. **Sales Phase:** Log in as **Sale**. Create a `New Order` and click `Confirm Sale`. (Notice the absence of Invoicing tools).
2. **Invoicing Phase:** Log out, then log in as **Accountant**. Open the newly created order. Click `Create Invoice` -> `Confirm Invoice` -> `Register Payment`.
3. **Closing Phase:** Log out, then log in as **Sale** again. Open the order, verify the invoice status is **PAID**, and click `Mark As Done` to complete the lifecycle.