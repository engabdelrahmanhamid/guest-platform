import QRCode from 'qrcode';
import { qrPayload } from './state';

/**
 * The pass's QR code as an SVG document, drawn on the server so the guest page ships no QR
 * script. Medium error correction survives a scratched or dim phone screen at the gate.
 */
export async function passQrSvg(passToken: string): Promise<string> {
  return QRCode.toString(qrPayload(passToken), {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 2,
    color: { dark: '#111111', light: '#ffffff' },
  });
}
