Inventory-Dashboard Project Documentation
1. Project Overview
The Inventory-Dashboard is a web application designed to provide insights into sales, orders, and inventory data. It leverages a modern web development stack to offer a responsive and interactive user experience, with a focus on data visualization and efficient data fetching from a Supabase backend.

2. Tech Stack
The project utilizes the following key technologies:

Frontend Framework: React
Language: TypeScript
State Management/Data Fetching: React Query (@tanstack/react-query)
Backend/Database: Supabase (as a BaaS - Backend as a Service)
Styling: Tailwind CSS
Build Tool: Vite
Testing Framework (Unit/Integration): Vitest
End-to-End Testing: Playwright
Linting/Code Quality: ESLint (implied by node_modules/@eslint presence)
Development Utilities: lovable-tagger, lovable-agent-playwright-config
3. Core File Structure
The src directory is organized into logical modules, primarily focusing on React hooks for data fetching and business logic:

plaintext
 Show full code block 
src/
├── components/
│   └── ui/
│       └── toast.ts             # UI component definition for toast notifications
├── contexts/
│   └── StoreContext.ts          # React Context for managing store-wide filters
├── hooks/
│   ├── useChannelPerformance.ts # Hook for fetching and processing sales performance by channel
│   ├── useCentralInventory.ts   # Hook for fetching central inventory data and KPIs
│   ├── useInventoryDashboard.ts # Hook for fetching comprehensive inventory dashboard data
│   ├── useOrders.ts             # Hooks for fetching order lists, details, and line items
│   ├── useReports.ts            # Hooks for fetching saved reports and schedules
│   ├── useSalesKPIs.ts          # Hook for fetching and calculating key sales performance indicators
│   ├── useSalesTrend.ts         # Hook for fetching and processing sales trend data over time
│   ├── useStoreFilter.ts        # Hook for accessing and applying store filter parameters
│   ├── use-toast.ts             # Utility hook for displaying toast notifications
│   └── useTopProducts.ts        # Hook for fetching and analyzing top-selling products
├── integrations/
│   └── supabase/
│       └── client.ts            # Supabase client initialization and configuration
└── lib/
    └── dateRanges.ts            # Utility functions for handling date ranges
Root-level configuration files:

tailwind.config.ts: Tailwind CSS configuration.
vite.config.ts: Vite build tool configuration.
vitest.config.ts: Vitest testing framework configuration.
playwright.config.ts: Playwright end-to-end testing configuration.
playwright-fixture.ts: Playwright test fixture setup.
4. Main Functionalities Implemented So Far
The dashboard currently implements the following core functionalities:

Sales Analytics:
Key Performance Indicators (KPIs): Displays month-to-date (MTD) revenue, orders, average order value (AOV), sell-through rate, refund rate, and pending orders/approvals. Provides delta comparisons with the previous period.
Sales Trend: Visualizes daily revenue and order trends over a specified period (e.g., 30 days), including comparisons with the previous period.
Channel Performance: Breaks down sales performance by various channels (e.g., Online Store, POS, Amazon), showing revenue, orders, AOV, market share, and daily revenue for sparklines.
Collection Sales: Aggregates sales data by product collection, providing revenue figures for top-performing collections.
Product Performance:
Top Products: Identifies and lists top-selling products based on revenue, including units sold and trend analysis compared to the previous period.
Order Management:
Order Listing: Fetches and displays a paginated list of orders with filtering capabilities by status, channel, and date range.
Order Details: Retrieves detailed information for a specific order.
Order Line Items: Fetches and displays individual items within an order, including product details and pricing.
Inventory Management:
Inventory Dashboard: Provides an overview of inventory health, including on-hand stock, out-of-stock items, "winners" (low stock, high velocity), "losers" (old stock), stock value, WMS pool statistics, aging buckets, category breakdown, replenishment suggestions, and expiring-soon items.
Central Inventory: Lists all master variants with their available, reserved, and net available quantities, along with linked store counts.
Variant Store Mapping: Shows how a specific product variant is mapped across different stores and its central stock levels.
Customer Metrics:
Tracks unique and repeat customers, calculates retention rate, and estimates customer lifetime value (LTV).
Fulfillment Metrics:
Calculates the average fulfillment lag time in hours and the number of orders analyzed for this metric.
Reporting:
Saved Reports: Lists user-defined saved reports with details like template name, owner, and last updated time.
Report Schedules: Displays scheduled reports, including recipients, frequency, next run time, and active status.
Global Filtering:
Store Filter: Allows users to filter data across the dashboard by selecting a specific store or viewing data for all stores.
User Interface Feedback:
Toast Notifications: Provides a mechanism for displaying transient, non-intrusive messages to the user.
5. Component Interaction (Development Environment)
The development environment and tools interact to facilitate an efficient and collaborative workflow:

VS Code (IDE): Serves as the primary Integrated Development Environment. It provides:
TypeScript Support: IntelliSense, type checking, and code navigation for the TypeScript codebase.
ESLint Integration: Real-time feedback on code quality and style, ensuring adherence to project standards.
Git Integration: Version control management.
Terminal: For running npm/pnpm/yarn commands (e.g., vite dev server, vitest tests).
Vite (Build Tool):
Development Server: Provides a fast development server with Hot Module Replacement (HMR) for quick feedback loops during development.
Bundling: Optimizes the application for production deployment.
Plugin Integration: Uses @vitejs/plugin-react-swc for fast React compilation and lovable-tagger for component tagging (likely for internal tooling or analytics).
Vitest (Testing Framework):
Unit/Integration Testing: Used for writing and running tests for individual components and integrated modules.
jsdom Environment: Simulates a browser environment for testing React components.
Setup Files: Configured to run setup scripts (src/test/setup.ts) before tests.
Playwright (E2E Testing):
Browser Automation: Used for writing end-to-end tests that simulate real user interactions in a browser.
lovable-agent-playwright-config: Integrates with a custom Playwright configuration for specific testing needs, potentially related to agent-based testing or internal frameworks.
Supabase (Backend):
Data Source: All data displayed in the dashboard is fetched from and managed by Supabase.
Client Integration: The @supabase/supabase-js library is used to interact with Supabase services (Database, Auth, Storage, Functions) from the frontend.
Row Level Security (RLS): Supabase's RLS is crucial for securing data access, ensuring users only see data they are authorized to view.
AI Assistants (e.g., Gemini Code Assist):
Code Generation: Assists developers by generating boilerplate code, functions, or entire components based on natural language prompts.
Code Review/Refactoring: Provides suggestions for improving code quality, performance, and maintainability.
Debugging: Helps identify and resolve issues by explaining error messages or suggesting fixes.
Documentation: Generates comprehensive documentation, like this one, by analyzing the codebase and project structure.
This setup ensures a robust development lifecycle, from rapid prototyping and feature development to comprehensive testing and deployment, with AI assistance enhancing developer productivity.