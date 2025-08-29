'use client';

import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Frown, Loader2, LogIn, Server, FileText } from 'lucide-react';

import { connectToFtp, listCsvFiles, runAudit } from '@/app/actions';
import { AuditResult, DuplicateSku } from '@/lib/types';
import AuditReport from '@/components/audit-report';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

type Step = 'connect' | 'select' | 'auditing' | 'report' | 'error';

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

export default function AuditStepper() {
  const [step, setStep] = useState<Step>('connect');
  const [progressMessage, setProgressMessage] = useState('');
  const [csvFiles, setCsvFiles] = useState<string[]>([]);
  const [selectedCsv, setSelectedCsv] = useState<string>('');
  const [auditData, setAuditData] = useState<{ report: AuditResult[], summary: any, duplicates: DuplicateSku[] } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isPending, startTransition] = useTransition();
  const { toast } = useToast();

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
          setSelectedCsv(files[0]);
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
  
  const getFtpFormData = () => {
      const values = ftpForm.getValues();
      const formData = new FormData();
      formData.append('host', values.host);
      formData.append('username', values.username);
      formData.append('password', values.password);
      return formData;
  }

  const handleRunAudit = () => {
    if (!selectedCsv) {
      toast({ title: 'No File Selected', description: 'Please select a CSV file to start the audit.', variant: 'destructive' });
      return;
    }

    setStep('auditing');
    setProgressMessage('Starting audit... This may take a moment.');
    
    startTransition(async () => {
      try {
        const ftpData = getFtpFormData();
        const result = await runAudit(selectedCsv, ftpData);
        setAuditData(result);
        setProgressMessage('Report generated!');
        setTimeout(() => setStep('report'), 500);
      } catch (error) {
        const message = error instanceof Error ? error.message : "An unknown error occurred during the audit.";
        setErrorMessage(message);
        setStep('error');
      }
    });
  };
  
  const handleReset = () => {
    setStep('connect');
    setProgressMessage('');
    setCsvFiles([]);
    setSelectedCsv('');
    setAuditData(null);
    setErrorMessage('');
    ftpForm.reset(defaultFtpCredentials);
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
                <Select onValueChange={setSelectedCsv} value={selectedCsv}>
                  <FormControl>
                    <SelectTrigger id="csv-select">
                      <SelectValue placeholder="Select a file..." />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {csvFiles.map(file => <SelectItem key={file} value={file}>{file}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FormItem>
            </form>
          </Form>
        </CardContent>
        <CardFooter className="flex justify-between">
           <Button variant="outline" onClick={() => setStep('connect')}>Back</Button>
          <Button onClick={handleRunAudit} disabled={isPending || !selectedCsv}>
            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Run Audit
          </Button>
        </CardFooter>
      </Card>
    );
  }
  
  if (step === 'auditing') {
    return (
        <Card className="w-full max-w-md mx-auto">
            <CardHeader>
                <CardTitle>Audit in Progress</CardTitle>
                <CardDescription>Please wait while we sync with Shopify and generate your report.</CardDescription>
            </CardHeader>
            <CardContent className="text-center space-y-4 pt-6">
                <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
                <p className="text-sm text-muted-foreground font-medium">{progressMessage}</p>
            </CardContent>
        </Card>
    );
  }
  
  if (step === 'report' && auditData) {
    return <AuditReport data={auditData.report} summary={auditData.summary} duplicates={auditData.duplicates} onReset={handleReset} onRefresh={handleRunAudit} />;
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