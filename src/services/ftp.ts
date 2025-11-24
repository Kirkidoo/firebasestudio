import { Client } from 'basic-ftp';
import { Readable, Writable } from 'stream';

const FTP_DIRECTORY = process.env.FTP_DIRECTORY || '/Gamma_Product_Files/Shopify_Files/';

export async function getFtpClient(data: FormData) {
  const host = data.get('host') as string;
  const user = data.get('username') as string;
  const password = data.get('password') as string;

  const client = new Client(30000); // 30 second timeout
  // client.ftp.verbose = true;
  try {
    // First, try a secure connection
    console.log('Attempting secure FTP connection...');
    await client.access({ host, user, password, secure: true });
    console.log('Secure FTP connection successful.');
  } catch (secureErr) {
    console.log('Secure FTP connection failed. Trying non-secure.', secureErr);
    // If secure fails, close the potentially broken connection and try non-secure
    client.close();
    const nonSecureClient = new Client(30000); // 30 second timeout
    try {
      console.log('Attempting non-secure FTP connection...');
      await nonSecureClient.access({ host, user, password, secure: false });
      console.log('Non-secure FTP connection successful.');
      return nonSecureClient;
    } catch (nonSecureErr) {
      console.error('Non-secure FTP connection also failed.', nonSecureErr);
      throw new Error('Invalid FTP credentials or failed to connect.');
    }
  }
  return client;
}

export async function connectToFtp(data: FormData) {
  const client = await getFtpClient(data);
  client.close();
  return { success: true };
}

export async function listCsvFiles(data: FormData) {
  console.log('Listing CSV files from FTP...');
  const client = await getFtpClient(data);
  try {
    await client.cd(FTP_DIRECTORY);
    const files = await client.list();
    const csvFiles = files
      .filter((file: any) => file.name.toLowerCase().endsWith('.csv'))
      .map((file: any) => file.name);
    console.log(`Found ${csvFiles.length} CSV files.`);
    return csvFiles;
  } catch (error) {
    console.error('Failed to list CSV files:', error);
    throw error;
  } finally {
    if (!client.closed) {
      client.close();
    }
  }
}

export async function getCsvStreamFromFtp(
  csvFileName: string,
  ftpData: FormData
): Promise<Readable> {
  const client = await getFtpClient(ftpData);
  try {
    console.log('Navigating to FTP directory:', FTP_DIRECTORY);
    await client.cd(FTP_DIRECTORY);
    console.log(`Downloading file: ${csvFileName}`);

    // Create a PassThrough stream to pipe the download into
    const passThrough = new Readable({
      read() { },
    });

    // We need to keep the client open while the stream is being read.
    // However, basic-ftp doesn't support returning a stream directly easily without closing the client too early if we await downloadTo.
    // The strategy here is to not await downloadTo fully before returning, OR use a different approach.
    // basic-ftp's downloadTo accepts a Writable.

    // Better approach for basic-ftp to ensure client stays open:
    // We can't easily return a stream and close the client *after* the stream is consumed in this function scope.
    // We will rely on the caller to handle the stream, but we need to manage the client lifecycle.
    // A common pattern is to pass a callback or return a cleanup function, but let's try to adapt to the existing signature.

    // Actually, basic-ftp has a `trackProgress` which might not be enough.
    // Let's use a PassThrough stream and pipe data to it.
    // BUT, we must not close the client until the download is finished.
    // If we return the stream, the download happens asynchronously.

    const { PassThrough } = await import('stream');
    const stream = new PassThrough();

    // Start the download asynchronously
    client.downloadTo(stream, csvFileName).then(
      () => {
        console.log('File download completed.');
        client.close();
      },
      (err) => {
        console.error('File download failed:', err);
        stream.destroy(err);
        client.close();
      }
    );

    return stream;
  } catch (error) {
    client.close();
    throw error;
  }
}
