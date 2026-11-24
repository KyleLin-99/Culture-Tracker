// Phones: the system print dialog (AirPrint on iPhone; Android's print service,
// which Brother's "Brother Print Service Plugin" adds Brother printers to).
import * as Print from 'expo-print';

export async function printHtml(html: string): Promise<void> {
  await Print.printAsync({ html });
}
