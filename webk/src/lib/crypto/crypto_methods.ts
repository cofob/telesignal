import type bytesModPow from '@helpers/bytes/bytesModPow';
// import type gzipCompress from '@helpers/gzipCompress';
import type gzipUncompress from '@helpers/gzipUncompress';
import type getEmojisFingerprint from '@lib/calls/helpers/getEmojisFingerprint';
import type {aesCtrDestroy, aesCtrPrepare, aesCtrProcess} from '@lib/crypto/aesCtrUtils';
import type computeDhKey from '@lib/crypto/computeDhKey';
import type generateDh from '@lib/crypto/generateDh';
import type computeSRP from '@lib/crypto/srp';
import type {encryptLocalData, decryptLocalData} from '@lib/crypto/utils/aesLocal';
import type pbkdf2 from '@lib/crypto/utils/pbkdf2';
import type sha1 from '@lib/crypto/utils/sha1';
import type sha256 from '@lib/crypto/utils/sha256';

export type CryptoMethods = {
  'sha1': typeof sha1,
  'sha256': typeof sha256,
  'pbkdf2': typeof pbkdf2,
  'mod-pow': typeof bytesModPow,
  // 'gzipCompress': typeof gzipCompress,
  'gzipUncompress': typeof gzipUncompress,
  'computeSRP': typeof computeSRP,
  'generate-dh': typeof generateDh,
  'compute-dh-key': typeof computeDhKey,
  'get-emojis-fingerprint': typeof getEmojisFingerprint,
  'aes-ctr-prepare': typeof aesCtrPrepare,
  'aes-ctr-process': typeof aesCtrProcess,
  'aes-ctr-destroy': typeof aesCtrDestroy,
  'aes-local-encrypt': typeof encryptLocalData,
  'aes-local-decrypt': typeof decryptLocalData
};
