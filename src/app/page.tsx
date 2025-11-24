export const maxDuration = 300; // Allow up to 5 minutes for long audits
import { ShoppingBasket } from 'lucide-react';
import AuditStepper from '@/components/audit-stepper';
import Footer from '@/components/footer';

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4 sm:p-6 lg:p-8">
      <header className="mb-8 text-center">
        <div className="mb-2 inline-flex items-center gap-3">
          <ShoppingBasket className="h-10 w-10 text-primary" />
          <h1 className="text-4xl font-bold tracking-tight text-foreground">ShopSync Auditor</h1>
        </div>
        <p className="mx-auto max-w-2xl text-muted-foreground">
          Securely connect to your data sources, sync product information from Shopify, and generate
          a comprehensive audit report to identify discrepancies.
        </p>
      </header>

      <main className="w-full max-w-6xl">
        <AuditStepper />
      </main>

      <Footer />
    </div>
  );
}
