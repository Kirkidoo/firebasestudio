
'use client';

import { useState, useTransition, useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Frown, Loader2, LogIn, Server, FileText, Database, Check, Clock } from 'lucide-react';

import { connectToFtp, listCsvFiles, runAudit, runBulkAudit, checkBulkCacheStatus } from '@/app/actions';
import { AuditResult, DuplicateSku } from '@/lib/types';
import AuditReport from '@/components/audit-report';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
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
  host: 'ftp.gammapowersports.com',
  username: 'ghs@gammasales.com',
  password: 'GHSaccess368!',
};

const BULK_AUDIT_FILE = 'ShopifyProductImport.csv';

export default function AuditStepper() {
  const [step, setStep] = useState<Step>('connect');
  const [activityLog, setActivityLog] = useState<string[]>([]);
  const [csvFiles, setCsvFiles] = useState<string[]>([]);
  const [selectedCsv, setSelectedCsv] = useState<string>('');
  const [auditData, setAuditData] = useState<{ report: AuditResult[], summary: any, duplicates: DuplicateSku[] } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isPending, startTransition] = useTransition();
  const { toast } = useToast();
  const [cacheStatus, setCacheStatus] = useState<{lastModified: string | null} | null>(null);

  const ftpForm = useForm<FtpFormData>({
    resolver: zodResolver(ftpSchema),
    defaultValues: defaultFtpCredentials,
  });

  const handleConnect = (values: FtpFormData) => {
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.append('host', values.host);
        formData.append('username', values.username);
        formData.append('password', values.password);

        await connectToFtp(formData);
        toast({ title: "FTP Connection Successful", description: "Ready to select a file." });
        const files = await listCsvFiles(formData);
        setCsvFiles(files);
        if (files.length > 0) {
          setSelectedCsv(files.includes(BULK_AUDIT_FILE) ? BULK_AUDIT_FILE : files[0]);
        }
        setStep('select');
      } catch (error) {
        const message = error instanceof Error ? error.message : "An unknown error occurred.";
        setErrorMessage(message);
        setStep('error');
        ftpForm.setError("username", { type: "manual", message });
      }
    });
  };
  
  const handleSelectChange = (value: string) => {
      setSelectedCsv(value);
      // Reset cache check when selection changes
      setCacheStatus(null);
  }
  
  const handleProgressCallback = useCallback((message: string) => {
      setActivityLog(prev => [...prev, message]);
  }, []);

  const handleRunAudit = (useCache = false) => {
    if (!selectedCsv) {
        toast({ title: 'No File Selected', description: 'Please select a CSV file to start.', variant: 'destructive' });
        return;
    }
    setStep('auditing');
    setActivityLog([]);
    
    const isBulk = selectedCsv === BULK_AUDIT_FILE;
    
    startTransition(async () => {
      try {
        const values = ftpForm.getValues();
        const ftpData = new FormData();
        ftpData.append('host', values.host);
        ftpData.append('username', values.username);
        ftpData.append('password', values.password);
        
        let result;
        if (isBulk) {
            result = await runBulkAudit(selectedCsv, ftpData, useCache, handleProgressCallback);
        } else {
            handleProgressCallback('Processing file... This may take a moment for large files.');
            result = await runAudit(selectedCsv, ftpData);
        }

        setAuditData(result);
        setTimeout(() => setStep('report'), 500);
      } catch (error) {
        const message = error instanceof Error ? error.message : "An unknown error occurred during the audit.";
        setErrorMessage(message);
        setStep('error');
      }
    });
  };
  
  const handleNextFromSelect = () => {
      if (selectedCsv === BULK_AUDIT_FILE) {
          setStep('cache_check');
          startTransition(async () => {
              const status = await checkBulkCacheStatus();
              setCacheStatus(status);
          });
      } else {
          handleRunAudit();
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
      const isBulk = selectedCsv === BULK_AUDIT_FILE;
      if (isBulk) {
          setStep('cache_check');
          startTransition(async () => {
              const status = await checkBulkCacheStatus();
              setCacheStatus(status);
          });
      } else {
          handleRunAudit();
      }
  };

  if (step === 'connect') {
    return (
      <Card className="w-full max-w-md mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Server className="w-5 h-5" />FTP Server Connection</CardTitle>
          <CardDescription>Enter your credentials to securely connect to the FTP server.</CardDescription>
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
                      <Input placeholder="ftp.your-domain.com" {...field} />
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
                      <Input placeholder="your-username" {...field} />
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
                      <Input type="password" {...field} />
                    </FormControl>
                     <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
            <CardFooter>
              <Button type="submit" className="w-full" disabled={isPending}>
                {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogIn className="mr-2 h-4 w-4" />}
                Connect
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>
    );
  }

  if (step === 'select') {
    return (
      <Card className="w-full max-w-md mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileText className="w-5 h-5"/>Select CSV File</CardTitle>
          <CardDescription>Choose the CSV file from the FTP server to start the audit.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...ftpForm}>
            <form>
              <FormItem>
                <FormLabel htmlFor="csv-select">CSV File</FormLabel>
                <Select onValueChange={handleSelectChange} value={selectedCsv}>
                  <FormControl>
                    <SelectTrigger id="csv-select">
                      <SelectValue placeholder="Select a file..." />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {csvFiles.map(file => <SelectItem key={file} value={file}>{file}</SelectItem>)}
                  </SelectContent>
                </Select>
                 {selectedCsv === BULK_AUDIT_FILE && (
                    <Alert className="mt-4">
                        <AlertTitle>Bulk Audit Mode</AlertTitle>
                        <AlertDescription>
                            This large file will be compared against all products in your Shopify store. The process may take several minutes.
                        </AlertDescription>
                    </Alert>
                )}
              </FormItem>
            </form>
          </Form>
        </CardContent>
        <CardFooter className="flex justify-between">
           <Button variant="outline" onClick={() => setStep('connect')}>Back</Button>
          <Button onClick={handleNextFromSelect} disabled={isPending || !selectedCsv}>
            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Next
          </Button>
        </CardFooter>
      </Card>
    );
  }
  
  if (step === 'cache_check') {
    return (
         <Card className="w-full max-w-md mx-auto">
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><Database className="w-5 h-5"/>Bulk Operation Cache</CardTitle>
                <CardDescription>You can use cached Shopify data to speed up the audit, or start a new operation to get the latest data.</CardDescription>
            </CardHeader>
            <CardContent className="text-center space-y-4">
                {isPending ? (
                    <>
                        <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
                        <p className="text-sm text-muted-foreground">Checking for cached data...</p>
                    </>
                ) : cacheStatus?.lastModified ? (
                     <Alert>
                        <AlertTitle>Cached Data Found</AlertTitle>
                        <AlertDescription>
                            Last updated: {formatDistanceToNow(new Date(cacheStatus.lastModified), { addSuffix: true })}.
                        </AlertDescription>
                    </Alert>
                ) : (
                    <Alert variant="destructive">
                        <AlertTitle>No Cached Data</AlertTitle>
                        <AlertDescription>
                            A new bulk operation will be started to fetch all products from Shopify.
                        </AlertDescription>
                    </Alert>
                )}
            </CardContent>
            <CardFooter className="flex flex-col sm:flex-row justify-between gap-2">
               <Button variant="outline" onClick={() => setStep('select')} className="w-full sm:w-auto">Back</Button>
               <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                   <Button onClick={() => handleRunAudit(true)} disabled={isPending || !cacheStatus?.lastModified} className="w-full sm:w-auto">
                       Use Cached Data
                   </Button>
                   <Button onClick={() => handleRunAudit(false)} disabled={isPending} className="w-full sm:w-auto">
                       Start New Bulk Operation
                   </Button>
               </div>
            </CardFooter>
        </Card>
    );
  }
  
  if (step === 'auditing') {
    const isBulk = selectedCsv === BULK_AUDIT_FILE;
    return (
        <Card className="w-full max-w-lg mx-auto">
            <CardHeader>
                <CardTitle>Processing File</CardTitle>
                <CardDescription>Please wait while we process your file. This may take several minutes.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-6">
                <div className="flex justify-center">
                    <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
                </div>
                {isBulk && (
                    <div className="mt-4 p-4 border rounded-lg bg-muted/50 max-h-60 overflow-y-auto">
                        <h3 className="font-semibold mb-2">Activity Log</h3>
                        <ul className="space-y-2 text-sm text-muted-foreground">
                            {activityLog.map((log, index) => {
                                const isDone = activityLog.length > index + 1 || log.toLowerCase().includes('finished') || log.toLowerCase().includes('completed') || log.toLowerCase().includes('found');
                                return (
                                    <li key={index} className="flex items-start gap-3">
                                        {isDone ? (
                                            <Check className="h-4 w-4 mt-0.5 text-green-500 shrink-0" />
                                        ) : (
                                            <Clock className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                                        )}
                                        <span>{log}</span>
                                    </li>
                                )
                            })}
                        </ul>
                    </div>
                )}
            </CardContent>
        </Card>
    );
  }
  
  if (step === 'report' && auditData) {
    return <AuditReport data={auditData.report} summary={auditData.summary} duplicates={auditData.duplicates} fileName={selectedCsv} onReset={handleReset} onRefresh={handleRefresh} />;
  }

  if (step === 'error') {
    return (
        <Card className="w-full max-w-md mx-auto">
           <Alert variant="destructive" className="mt-6">
             <Frown className="h-4 w-4" />
             <AlertTitle>An Error Occurred</AlertTitle>
             <AlertDescription>
                {errorMessage}
             </AlertDescription>
           </Alert>
           <CardFooter className="mt-4">
             <Button onClick={handleReset} className="w-full">Start Over</Button>
           </CardFooter>
        </Card>
    );
  }

  return null;
}

    