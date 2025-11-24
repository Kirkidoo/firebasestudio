'use client';

import { useState, useTransition, useEffect, useCallback, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Frown, Loader2, LogIn, Server, FileText, Database, Check, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import {
  connectToFtp,
  listCsvFiles,
  runAudit,
  checkBulkCacheStatus,
  getCsvProducts,
  getShopifyProductsFromCache,
  startBulkOperation,
  checkBulkOperationStatus,
  getBulkOperationResultAndParse,
  runBulkAuditComparison,
  getFtpCredentials,
} from '@/app/actions';
import { AuditResult, DuplicateSku, Product } from '@/lib/types';
import AuditReport from '@/components/audit-report';
import { ActivityLogViewer } from '@/components/activity-log-viewer';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { formatDistanceToNow } from 'date-fns';

type Step = 'connect' | 'select' | 'auditing' | 'report' | 'error' | 'cache_check';

const ftpSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

type FtpFormData = z.infer<typeof ftpSchema>;

const defaultFtpCredentials = {
  host: '',
  username: '',
  password: '',
};

const BULK_AUDIT_FILE = 'ShopifyProductImport.csv';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const stepVariants = {
  initial: { opacity: 0, x: 20, scale: 0.95 },
  animate: { opacity: 1, x: 0, scale: 1 },
  exit: { opacity: 0, x: -20, scale: 0.95 },
};

export default function AuditStepper() {
  const [step, setStep] = useState<Step>('connect');
  const [activityLog, setActivityLog] = useState<string[]>([]);
  const [csvFiles, setCsvFiles] = useState<string[]>([]);
  const [selectedCsv, setSelectedCsv] = useState<string>('');
  const [auditData, setAuditData] = useState<{
    report: AuditResult[];
    summary: any;
    duplicates: DuplicateSku[];
  } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isPending, startTransition] = useTransition();
  const { toast } = useToast();
  const [cacheStatus, setCacheStatus] = useState<{ lastModified: string | null } | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const ftpForm = useForm<FtpFormData>({
    resolver: zodResolver(ftpSchema),
    defaultValues: defaultFtpCredentials,
  });

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activityLog]);

  useEffect(() => {
    const fetchCredentials = async () => {
      try {
        const creds = await getFtpCredentials();
        console.log('Fetched credentials from server:', {
          host: creds.host,
          username: creds.username,
          hasPassword: !!creds.password
        });

        const currentValues = ftpForm.getValues();
        if ((creds.host || creds.username || creds.password) &&
          !currentValues.host && !currentValues.username && !currentValues.password) {
          ftpForm.reset(creds);
        }
      } catch (error) {
        console.error('Failed to fetch default credentials:', error);
      }
    };
    fetchCredentials();
  }, [ftpForm]);

  const handleConnect = (values: FtpFormData) => {
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.append('host', values.host);
        formData.append('username', values.username);
        formData.append('password', values.password);

        await connectToFtp(formData);
        toast({ title: 'FTP Connection Successful', description: 'Ready to select a file.' });
        const files = await listCsvFiles(formData);
        setCsvFiles(files);
        if (files.length > 0) {
          setSelectedCsv(files.includes(BULK_AUDIT_FILE) ? BULK_AUDIT_FILE : files[0]);
        }
        setStep('select');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'An unknown error occurred.';
        setErrorMessage(message);
        setStep('error');
        ftpForm.setError('username', { type: 'manual', message });
      }
    });
  };

  const handleSelectChange = (value: string) => {
    setSelectedCsv(value);
    // Reset cache check when selection changes
    setCacheStatus(null);
  };

  const addLog = (message: string) => {
    setActivityLog((prev) => [...prev, message]);
  };

  const handleRunStandardAudit = () => {
    if (!selectedCsv) {
      toast({
        title: 'No File Selected',
        description: 'Please select a CSV file to start.',
        variant: 'destructive',
      });
      return;
    }
    setStep('auditing');
    setActivityLog([]);
    addLog('Starting standard audit...');

    startTransition(async () => {
      try {
        const values = ftpForm.getValues();
        const ftpData = new FormData();
        ftpData.append('host', values.host);
        ftpData.append('username', values.username);
        ftpData.append('password', values.password);

        addLog(`Downloading and parsing ${selectedCsv}...`);
        const result = await runAudit(selectedCsv, ftpData);

        if (!result || !result.report || !result.summary || !result.duplicates) {
          throw new Error('An unexpected response was received from the server.');
        }

        addLog('Audit complete!');
        setAuditData(result);
        setTimeout(() => setStep('report'), 500);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'An unexpected response was received from the server during the audit.';
        setErrorMessage(message);
        setStep('error');
      }
    });
  };

  const handleRunBulkAudit = (useCache: boolean) => {
    setStep('auditing');
    setActivityLog([]);

    startTransition(async () => {
      try {
        const values = ftpForm.getValues();
        const ftpData = new FormData();
        ftpData.append('host', values.host);
        ftpData.append('username', values.username);
        ftpData.append('password', values.password);

        addLog('Downloading CSV file from FTP...');
        const csvProducts = await getCsvProducts(selectedCsv, ftpData);
        if (!csvProducts) {
          throw new Error('Could not retrieve products from CSV file.');
        }
        addLog(`Found ${csvProducts.length} products in CSV.`);

        let shopifyProducts: Product[] | null = [];

        if (useCache) {
          addLog('Using cached Shopify data...');
          shopifyProducts = await getShopifyProductsFromCache();
          if (!shopifyProducts) {
            addLog('Cache miss or error. Fetching fresh data...');
            useCache = false; // Force fetch
          }
        }

        if (!useCache) {
          addLog('Requesting new product export from Shopify...');
          let operation = await startBulkOperation();
          addLog(`Bulk operation started: ${operation.id}`);

          while (operation.status === 'RUNNING' || operation.status === 'CREATED') {
            addLog(`Waiting for Shopify... (Status: ${operation.status})`);
            await sleep(5000); // Poll every 5 seconds
            operation = await checkBulkOperationStatus(operation.id);
          }

          if (operation.status !== 'COMPLETED') {
            throw new Error(
              `Shopify bulk operation failed or was cancelled. Status: ${operation.status}`
            );
          }

          addLog('Shopify export completed.');

          if (!operation.resultUrl) {
            throw new Error(`Shopify bulk operation completed, but did not provide a result URL.`);
          }

          addLog('Downloading and parsing exported data from Shopify...');
          shopifyProducts = await getBulkOperationResultAndParse(operation.resultUrl);
          addLog('Caching complete.');
        }

        if (!shopifyProducts) {
          throw new Error('Could not retrieve products from Shopify.');
        }

        addLog(`Found ${shopifyProducts.length} products in Shopify.`);
        addLog('Generating audit report...');
        const result = await runBulkAuditComparison(csvProducts, shopifyProducts, selectedCsv);

        if (!result || !result.report || !result.summary || !result.duplicates) {
          throw new Error('An unexpected response was received from the server after bulk audit.');
        }

        addLog('Report finished!');
        setAuditData(result);
        setTimeout(() => setStep('report'), 500);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'An unexpected response was received during the audit.';
        setErrorMessage(message);
        setStep('error');
      }
    });
  };

  const handleNextFromSelect = () => {
    if (selectedCsv) {
      setStep('cache_check');
      startTransition(async () => {
        const status = await checkBulkCacheStatus();
        setCacheStatus(status);
      });
    }
  };

  const handleReset = () => {
    setStep('connect');
    setActivityLog([]);
    setCsvFiles([]);
    setSelectedCsv('');
    setAuditData(null);
    setErrorMessage('');
    setCacheStatus(null);
    ftpForm.reset(defaultFtpCredentials);
  };

  const handleRefresh = () => {
    // Always go back to method selection for refresh to be safe, or just re-run the last method?
    // For simplicity, let's go back to cache_check which acts as the method selector now.
    setStep('cache_check');
    startTransition(async () => {
      const status = await checkBulkCacheStatus();
      setCacheStatus(status);
    });
  };

  return (
    <div className="w-full max-w-4xl mx-auto p-4">
      <AnimatePresence mode="wait">
        {step === 'connect' && (
          <motion.div
            key="connect"
            variants={stepVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ duration: 0.3 }}
          >
            <Card className="mx-auto w-full max-w-md border-primary/10 shadow-2xl shadow-primary/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-primary">
                  <Server className="h-5 w-5" />
                  FTP Server Connection
                </CardTitle>
                <CardDescription>
                  Enter your credentials to securely connect to the FTP server.
                </CardDescription>
              </CardHeader>
              <Form {...ftpForm}>
                <form onSubmit={ftpForm.handleSubmit(handleConnect)}>
                  <CardContent className="space-y-4">
                    <FormField
                      control={ftpForm.control}
                      name="host"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>FTP Host</FormLabel>
                          <FormControl>
                            <Input placeholder="ftp.your-domain.com" {...field} className="bg-background/50" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={ftpForm.control}
                      name="username"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Username</FormLabel>
                          <FormControl>
                            <Input placeholder="your-username" {...field} className="bg-background/50" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={ftpForm.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Password</FormLabel>
                          <FormControl>
                            <Input type="password" {...field} className="bg-background/50" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </CardContent>
                  <CardFooter>
                    <Button type="submit" className="w-full" disabled={isPending}>
                      {isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <LogIn className="mr-2 h-4 w-4" />
                      )}
                      Connect
                    </Button>
                  </CardFooter>
                </form>
              </Form>
            </Card>
          </motion.div>
        )}

        {step === 'select' && (
          <motion.div
            key="select"
            variants={stepVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ duration: 0.3 }}
          >
            <Card className="mx-auto w-full max-w-md border-primary/10 shadow-2xl shadow-primary/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-primary">
                  <FileText className="h-5 w-5" />
                  Select CSV File
                </CardTitle>
                <CardDescription>
                  Choose the CSV file from the FTP server to start the audit.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...ftpForm}>
                  <form>
                    <FormItem>
                      <FormLabel htmlFor="csv-select">CSV File</FormLabel>
                      <Select onValueChange={handleSelectChange} value={selectedCsv}>
                        <FormControl>
                          <SelectTrigger id="csv-select" className="bg-background/50">
                            <SelectValue placeholder="Select a file..." />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {csvFiles.map((file) => (
                            <SelectItem key={file} value={file}>
                              {file}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  </form>
                </Form>
              </CardContent>
              <CardFooter className="flex justify-between">
                <Button variant="outline" onClick={() => setStep('connect')}>
                  Back
                </Button>
                <Button onClick={handleNextFromSelect} disabled={isPending || !selectedCsv}>
                  {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Next
                </Button>
              </CardFooter>
            </Card>
          </motion.div>
        )}

        {step === 'cache_check' && (
          <motion.div
            key="cache_check"
            variants={stepVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ duration: 0.3 }}
          >
            <Card className="mx-auto w-full max-w-2xl border-primary/10 shadow-2xl shadow-primary/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-primary">
                  <Database className="h-5 w-5" />
                  Choose Audit Method
                </CardTitle>
                <CardDescription>
                  Select how you want to compare the CSV against Shopify.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {isPending && !cacheStatus ? (
                  <div className="flex flex-col items-center justify-center py-8">
                    <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
                    <p className="text-sm text-muted-foreground animate-pulse">Checking for cached data...</p>
                  </div>
                ) : (
                  <div className="grid gap-6 md:grid-cols-2">
                    {/* Option 1: Bulk / Cache */}
                    <div className="space-y-4 rounded-lg border p-4 hover:bg-accent/5 transition-colors">
                      <div className="flex items-center gap-2 font-semibold text-foreground">
                        <Database className="h-4 w-4 text-blue-500" />
                        Bulk Audit (Recommended)
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Uses Shopify's Bulk API. Best for large files and 100% accuracy.
                        {cacheStatus?.lastModified ? (
                          <span className="block mt-2 text-green-600 dark:text-green-400 font-medium">
                            Cache available from {formatDistanceToNow(new Date(cacheStatus.lastModified), { addSuffix: true })}.
                          </span>
                        ) : (
                          <span className="block mt-2 text-orange-600 dark:text-orange-400 font-medium">
                            No cache found. Will start a new export (takes time).
                          </span>
                        )}
                      </p>
                      <div className="flex flex-col gap-2">
                        <Button
                          onClick={() => handleRunBulkAudit(true)}
                          disabled={isPending || !cacheStatus?.lastModified}
                          variant={cacheStatus?.lastModified ? "default" : "secondary"}
                          className="w-full"
                        >
                          Use Cached Data
                        </Button>
                        <Button
                          onClick={() => handleRunBulkAudit(false)}
                          disabled={isPending}
                          variant="outline"
                          className="w-full"
                        >
                          Start New Bulk Export
                        </Button>
                      </div>
                    </div>

                    {/* Option 2: Live Audit */}
                    <div className="space-y-4 rounded-lg border p-4 hover:bg-accent/5 transition-colors">
                      <div className="flex items-center gap-2 font-semibold text-foreground">
                        <Server className="h-4 w-4 text-green-500" />
                        Live Audit
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Queries Shopify in real-time. Good for small files or quick checks.
                        <span className="block mt-2 text-muted-foreground">
                          Now includes verification step to prevent false positives.
                        </span>
                      </p>
                      <Button
                        onClick={handleRunStandardAudit}
                        disabled={isPending}
                        variant="secondary"
                        className="w-full mt-auto"
                      >
                        Run Live Audit
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
              <CardFooter className="flex justify-start">
                <Button variant="outline" onClick={() => setStep('select')}>
                  Back
                </Button>
              </CardFooter>
            </Card>
          </motion.div>
        )}

        {step === 'auditing' && (
          <motion.div
            key="auditing"
            variants={stepVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ duration: 0.3 }}
          >
            <Card className="mx-auto w-full max-w-lg border-primary/10 shadow-2xl shadow-primary/5">
              <CardHeader>
                <CardTitle className="text-primary">Processing File</CardTitle>
                <CardDescription>
                  Please wait while we process your file. This may take several minutes.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 pt-6">
                <div className="flex justify-center py-8">
                  <div className="relative">
                    <div className="absolute inset-0 rounded-full blur-xl bg-primary/20 animate-pulse"></div>
                    <Loader2 className="relative h-16 w-16 animate-spin text-primary" />
                  </div>
                </div>
                {activityLog.length > 0 && (
                  <div className="mt-4 max-h-60 overflow-y-auto rounded-lg border bg-muted/50 p-4 font-mono text-sm">
                    <h3 className="mb-2 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Activity Log</h3>
                    <ul className="space-y-2">
                      <AnimatePresence initial={false}>
                        {activityLog.map((log, index) => {
                          const isDone =
                            activityLog.length > index + 1 ||
                            log.toLowerCase().includes('finished') ||
                            log.toLowerCase().includes('complete');
                          return (
                            <motion.li
                              key={index}
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              className="flex items-start gap-3"
                            >
                              {isDone ? (
                                <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                              ) : (
                                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-primary animate-pulse" />
                              )}
                              <span className={isDone ? 'text-muted-foreground' : 'text-foreground font-medium'}>{log}</span>
                            </motion.li>
                          );
                        })}
                      </AnimatePresence>
                      <div ref={logEndRef} />
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        )}

        {step === 'report' && auditData && (
          <motion.div
            key="report"
            variants={stepVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ duration: 0.3 }}
            className="w-full"
          >
            <AuditReport
              data={auditData.report}
              summary={auditData.summary}
              duplicates={auditData.duplicates}
              fileName={selectedCsv}
              onReset={handleReset}
              onRefresh={handleRefresh}
            />
          </motion.div>
        )}

        {step === 'error' && (
          <motion.div
            key="error"
            variants={stepVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ duration: 0.3 }}
          >
            <Card className="mx-auto w-full max-w-md border-destructive/20 shadow-2xl shadow-destructive/5">
              <CardContent className="pt-6">
                <Alert variant="destructive" className="border-destructive/50 bg-destructive/5">
                  <Frown className="h-4 w-4" />
                  <AlertTitle>An Error Occurred</AlertTitle>
                  <AlertDescription>{errorMessage}</AlertDescription>
                </Alert>
              </CardContent>
              <CardFooter>
                <Button onClick={handleReset} className="w-full" variant="destructive">
                  Start Over
                </Button>
              </CardFooter>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
      <ActivityLogViewer />
    </div>
  );
}
