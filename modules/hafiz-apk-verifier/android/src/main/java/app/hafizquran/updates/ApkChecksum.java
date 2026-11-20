package app.hafizquran.updates;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

final class ApkChecksum {
  private ApkChecksum() {}

  static String sha256(File directory, String name) throws IOException, NoSuchAlgorithmException {
    if (!name.matches("[1-9][0-9]{0,9}\\.apk(?:\\.part)?")) {
      throw new IllegalArgumentException("Invalid update file name");
    }
    File file = new File(directory, name);
    if (!file.getCanonicalFile().getParentFile().equals(directory.getCanonicalFile())) {
      throw new IOException("Update file is outside the updates directory");
    }
    MessageDigest digest = MessageDigest.getInstance("SHA-256");
    try (FileInputStream stream = new FileInputStream(file)) {
      byte[] buffer = new byte[64 * 1024];
      int count;
      while ((count = stream.read(buffer)) != -1) {
        digest.update(buffer, 0, count);
      }
    }
    StringBuilder hex = new StringBuilder(64);
    for (byte value : digest.digest()) {
      hex.append(Character.forDigit((value & 0xff) >>> 4, 16));
      hex.append(Character.forDigit(value & 0xf, 16));
    }
    return hex.toString();
  }
}
