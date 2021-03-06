import * as empty from 'is-empty';
import * as ByteBuffer from 'bytebuffer';
import * as BigNumber from 'bignumber.js';
import {api as sodium} from 'sodium';

import {bigNumberFromBuffer, bigNumberToBuffer} from '../utils/bignumber';
import {toSha256} from '../utils/sha256';

export interface Transaction<AssetType = {}> {
  recipientId: string;
  amount: number;
  senderPublicKey: string;
  requesterPublicKey: string;
  timestamp: number;
  fee: number;
  asset: AssetType,
  type: number;
  id: string;
  signature: string;
  secondSignature?: string;
}

/**
 * Base transaction class.
 */
export abstract class BaseTx<T = {}> {
  recipientId: string;
  amount: number;
  senderPublicKey: string;
  requesterPublicKey: string = null;
  timestamp: number;
  fee: number;
  protected abstract type: number;

  constructor(public asset?: T) {
  }

  // Transients
  protected _signature: string;
  protected _secondSignature?: string;
  protected _id: string;


  sign(signingPrivKey: string, signingSecondPrivKey?: string): Transaction<T> {
    if (empty(this.type) && this.type !== 0) {
      throw new Error(`Unknown transaction type ${this.type}`);
    }
    if (empty(this.senderPublicKey)) {
      throw new Error(`Sender Public Key is empty`);
    }
    if (empty(this.timestamp) && this.timestamp < 0) {
      throw new Error(`Invalid timestamp provided`);
    }

    this.innerCreate();
    this._signature = this.createSignature(signingPrivKey).toString('hex');

    if (!empty(signingSecondPrivKey)) {
      this._secondSignature = this.createSignature(signingSecondPrivKey).toString('hex');
    }

    this._id = this.calcId();
    return this.toObj();
  }

  /**
   * Returns plain object representation of tx (if not signed error will be thrown)
   */
  protected toObj(): Transaction<T> {
    const toRet = {
      id                : this._id,
      fee               : this.fee,
      type              : this.type,
      recipientId       : this.recipientId,
      amount            : this.amount,
      senderPublicKey   : this.senderPublicKey,
      requesterPublicKey: this.requesterPublicKey,
      timestamp         : this.timestamp,
      signature         : this._signature,
      secondSignature   : this._secondSignature || undefined,
      asset             : this.asset
    };
    if (empty(toRet.secondSignature)) {
      delete toRet.secondSignature;
    }
    return toRet;
  }

  /**
   * Generate signature from given private key.
   * @param {string} privKey
   * @returns {Buffer}
   */
  protected createSignature(privKey: string) {
    const hash = this.getHash();
    return sodium.crypto_sign_detached(
      hash,
      new Buffer(privKey, 'hex')
    );
  }


  get signature() {
    if (empty(this._signature)) {
      throw new Error('Call create first');
    }
    return this._signature;
  }

  get id() {
    if (empty(this._id)) {
      throw new Error('Call create first');
    }
    return this._id;
  }

  /**
   * Calculates Tx id!
   * @returns {string}
   */
  protected calcId(): string {
    const hash = this.getHash();
    const temp = new Buffer(8);
    for (let i = 0; i < 8; i++) {
      temp[i] = hash[7 - i];
    }

    return bigNumberFromBuffer(temp).toString()
  }

  /**
   * Gets raw hash of current tx
   */
  getHash(): Buffer {
    return toSha256(this.getBytes());
  }

  /**
   * Calculates bytes of tx.
   * @param {boolean} skipSignature=false true if you don't want to account signature
   * @param {boolean} skipSecondSign=false true if you don't want to account second signature
   * @returns {Buffer}
   */
  getBytes(skipSignature: boolean = false, skipSecondSign: boolean = false): Buffer {
    const childBytes = this.getChildBytes(skipSignature, skipSecondSign);
    const assetSize  = empty(childBytes) ? 0 : childBytes.length;
    const bb         = new ByteBuffer(1 + 4 + 32 + 32 + 8 + 8 + 64 + 64 + assetSize, true);
    bb.writeByte(this.type);
    bb.writeInt(this.timestamp);

    BaseTx.hexKeyInByteBuffer(this.senderPublicKey, bb);

    if (!empty(this.requesterPublicKey)) {
      BaseTx.hexKeyInByteBuffer(this.requesterPublicKey, bb);
    }

    if (!empty(this.recipientId)) {
      const recipient = bigNumberToBuffer(
        new BigNumber(this.recipientId.slice(0, -1)),
        { size: 8 }
      );

      for (let i = 0; i < 8; i++) {
        bb.writeByte(recipient[i] || 0);
      }
    } else {
      for (let i = 0; i < 8; i++) {
        bb.writeByte(0);
      }
    }

    bb['writeLong'](this.amount);

    if (assetSize > 0) {
      for (let i = 0; i < assetSize; i++) {
        bb.writeByte(childBytes[i]);
      }
    }

    if (!skipSignature && !empty(this._signature)) {
      BaseTx.hexKeyInByteBuffer(this._signature, bb);
    }

    if (!skipSecondSign && !empty(this._secondSignature)) {
      BaseTx.hexKeyInByteBuffer(this._secondSignature, bb);
    }
    bb.flip();

    // TODO: Check? this returns an array buffer which does not
    // inherit from buffer (according to ts types).
    return new Buffer(bb.toBuffer());
  }


  /**
   * Override to calculate asset bytes.
   * @param {boolean} skipSignature
   * @param {boolean} skipSecondSign
   */
  protected abstract getChildBytes(skipSignature: boolean, skipSecondSign: boolean): Buffer;

  /**
   * override this to allow asset and other fields creations.
   * for different tx types.
   */
  protected innerCreate() {
  };

  // chain style utilities.

  set(key: keyof this, value: any): this {
    this[key] = value;
    return this;
  }

  withRecipientId(recipientId: string): this {
    return this.set('recipientId', recipientId);
  }

  withAmount(amount: number): this {
    return this.set('amount', amount);
  }

  withSenderPublicKey(senderPublicKey: string): this {
    return this.set('senderPublicKey', senderPublicKey);
  }

  withRequesterPublicKey(senderPublicKey: string): this {
    return this.set('requesterPublicKey', senderPublicKey);
  }

  withTimestamp(timestamp: number): this {
    return this.set('timestamp', timestamp);
  }

  withFees(fees: number): this {
    return this.set('fee', fees);
  }


  /**
   * Utility to copy an hex string to a bytebuffer
   * @param {string} hex
   * @param {ByteBuffer} bb
   */
  public static hexKeyInByteBuffer(hex: string, bb: ByteBuffer) {
    const buf = Buffer.from(hex, 'hex');
    for (let i = 0; i < buf.length; i++) {
      bb.writeByte(buf[i]);
    }
  }

}