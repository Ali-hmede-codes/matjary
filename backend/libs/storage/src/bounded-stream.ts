import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { Transform, type TransformCallback } from 'node:stream';

// Enforce actual bytes, including chunked uploads without Content-Length.
export class ByteLimit extends Transform {
  bytes = 0;
  constructor(
    private readonly maximum: number,
    private readonly exact = false,
  ) {
    super();
  }
  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    this.bytes += chunk.length;
    if (this.bytes > this.maximum)
      callback(new PayloadTooLargeException('Media exceeds the size limit'));
    else callback(null, chunk);
  }
  override _flush(callback: TransformCallback): void {
    callback(
      this.exact && this.bytes !== this.maximum
        ? new BadRequestException(
            'Upload size does not match the declared size',
          )
        : undefined,
    );
  }
}
