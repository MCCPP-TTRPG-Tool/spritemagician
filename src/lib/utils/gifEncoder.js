/**
 * Simple GIF encoder - no workers, no external dependencies
 * Based on NeuQuant algorithm for color quantization
 */

/**
 * Generate an animated GIF from an array of image sources
 * @param {string[]} frames - Array of image data URLs or URLs
 * @param {number} frameSize - Size to render each frame
 * @param {number} fps - Frames per second
 * @returns {Promise<Blob>} - GIF blob
 */
export async function generateGif(frames, frameSize = 256, fps = 12) {
	// GIF delay is in 1/100th of a second (centiseconds)
	// Calculate delay: 100 centiseconds = 1 second, so delay = 100 / fps
	const delay = Math.max(1, Math.round(100 / fps));
	
	// Load all images first
	const images = await Promise.all(frames.map(loadImage));
	
	// Determine actual dimensions from first frame
	// Use the larger dimension to ensure frames aren't too small
	const firstImg = images[0];
	const maxDimension = Math.max(firstImg.width, firstImg.height);
	// Use the larger of frameSize or actual frame dimensions to prevent tiny sprites
	const gifSize = frameSize > 0 ? Math.max(frameSize, maxDimension) : maxDimension;
	
	console.log(`[GIF] Frame dimensions: ${firstImg.width}x${firstImg.height}, GIF size: ${gifSize}x${gifSize}`);
	
	// Create encoder
	const encoder = new GifEncoder(gifSize, gifSize);
	encoder.setRepeat(0); // Loop forever
	encoder.setDelay(delay * 10); // setDelay expects milliseconds, so multiply by 10
	encoder.setQuality(10);
	encoder.start();
	
	// Create canvas for rendering
	const canvas = document.createElement('canvas');
	canvas.width = gifSize;
	canvas.height = gifSize;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	
	// Disable smoothing to preserve crisp quality
	ctx.imageSmoothingEnabled = false;
	
	// Add each frame
	for (const img of images) {
		// Clear canvas with white background (GIFs need opaque background)
		ctx.fillStyle = '#FFFFFF';
		ctx.fillRect(0, 0, gifSize, gifSize);
		
		// Scale to fill canvas while maintaining aspect ratio
		const scale = Math.min(gifSize / img.width, gifSize / img.height);
		const width = img.width * scale;
		const height = img.height * scale;
		const x = (gifSize - width) / 2;
		const y = (gifSize - height) / 2;
		ctx.drawImage(img, x, y, width, height);
		
		// Get image data and add frame
		const imageData = ctx.getImageData(0, 0, gifSize, gifSize);
		encoder.addFrame(imageData.data);
	}
	
	encoder.finish();
	
	return new Blob([new Uint8Array(encoder.out.data)], { type: 'image/gif' });
}

function loadImage(src) {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.crossOrigin = 'anonymous';
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error('Failed to load image'));
		img.src = src;
	});
}

// ============================================
// Embedded GIF Encoder (no external dependencies)
// ============================================

class GifEncoder {
	constructor(width, height) {
		this.width = width;
		this.height = height;
		this.transparent = null;
		this.transIndex = 0;
		this.repeat = -1;
		this.delay = 0;
		this.image = null;
		this.pixels = null;
		this.indexedPixels = null;
		this.colorDepth = null;
		this.colorTab = null;
		this.usedEntry = [];
		this.palSize = 7;
		this.dispose = -1;
		this.firstFrame = true;
		this.sample = 10;
		this.out = { data: [], writeByte: function(b) { this.data.push(b); }, writeBytes: function(arr) { this.data.push(...arr); } };
	}

	setDelay(ms) { this.delay = Math.round(ms / 10); }
	setRepeat(iter) { this.repeat = iter; }
	setTransparent(c) { this.transparent = c; }
	setDispose(code) { this.dispose = code; }
	setQuality(quality) { this.sample = quality < 1 ? 1 : quality; }
	
	start() {
		this.out.data = [];
		this.writeString('GIF89a');
	}
	
	addFrame(imageData) {
		this.image = imageData;
		this.getImagePixels();
		this.analyzePixels();
		
		if (this.firstFrame) {
			this.writeLSD();
			this.writePalette();
			if (this.repeat >= 0) this.writeNetscapeExt();
		}
		
		this.writeGraphicCtrlExt();
		this.writeImageDesc();
		if (!this.firstFrame) this.writePalette();
		this.writePixels();
		this.firstFrame = false;
	}
	
	finish() {
		this.out.writeByte(0x3B); // GIF trailer
	}
	
	getImagePixels() {
		const w = this.width;
		const h = this.height;
		this.pixels = new Uint8Array(w * h * 3);
		const data = this.image; // ImageData.data is RGBA format
		let count = 0;
		for (let i = 0; i < h; i++) {
			for (let j = 0; j < w; j++) {
				const b = (i * w * 4) + j * 4;
				// ImageData is RGBA, extract RGB (alpha already handled by canvas white background)
				this.pixels[count++] = data[b];     // R
				this.pixels[count++] = data[b + 1]; // G
				this.pixels[count++] = data[b + 2]; // B
			}
		}
	}
	
	analyzePixels() {
		const len = this.pixels.length;
		const nPix = len / 3;
		this.indexedPixels = new Uint8Array(nPix);
		const nq = new NeuQuant(this.pixels, this.sample);
		this.colorTab = nq.process();
		
		let k = 0;
		for (let j = 0; j < nPix; j++) {
			const index = nq.map(this.pixels[k++], this.pixels[k++], this.pixels[k++]);
			this.usedEntry[index] = true;
			this.indexedPixels[j] = index;
		}
		
		this.pixels = null;
		this.colorDepth = 8;
		this.palSize = 7;
	}
	
	writeString(s) {
		for (let i = 0; i < s.length; i++) this.out.writeByte(s.charCodeAt(i));
	}
	
	writeLSD() {
		this.writeShort(this.width);
		this.writeShort(this.height);
		this.out.writeByte(0x80 | 0x70 | this.palSize);
		this.out.writeByte(0);
		this.out.writeByte(0);
	}
	
	writeShort(val) {
		this.out.writeByte(val & 0xFF);
		this.out.writeByte((val >> 8) & 0xFF);
	}
	
	writePalette() {
		this.out.writeBytes(this.colorTab);
		const n = (3 * 256) - this.colorTab.length;
		for (let i = 0; i < n; i++) this.out.writeByte(0);
	}
	
	writeNetscapeExt() {
		this.out.writeByte(0x21);
		this.out.writeByte(0xFF);
		this.out.writeByte(11);
		this.writeString('NETSCAPE2.0');
		this.out.writeByte(3);
		this.out.writeByte(1);
		this.writeShort(this.repeat);
		this.out.writeByte(0);
	}
	
	writeGraphicCtrlExt() {
		this.out.writeByte(0x21);
		this.out.writeByte(0xF9);
		this.out.writeByte(4);
		this.out.writeByte(0);
		this.writeShort(this.delay);
		this.out.writeByte(0);
		this.out.writeByte(0);
	}
	
	writeImageDesc() {
		this.out.writeByte(0x2C);
		this.writeShort(0);
		this.writeShort(0);
		this.writeShort(this.width);
		this.writeShort(this.height);
		this.out.writeByte(this.firstFrame ? 0 : 0x80 | this.palSize);
	}
	
	writePixels() {
		const enc = new LZWEncoder(this.width, this.height, this.indexedPixels, this.colorDepth);
		enc.encode(this.out);
	}
}

// NeuQuant Neural-Net Quantization Algorithm
class NeuQuant {
	constructor(pixels, sample) {
		this.pixels = pixels;
		this.sample = sample;
		this.netsize = 256;
		this.network = [];
		this.netindex = new Int32Array(256);
		this.bias = new Int32Array(this.netsize);
		this.freq = new Int32Array(this.netsize);
		this.radpower = new Int32Array(32);
		
		for (let i = 0; i < this.netsize; i++) {
			const v = (i << 12) / this.netsize;
			this.network[i] = [v, v, v, 0];
			this.freq[i] = 256 / this.netsize;
			this.bias[i] = 0;
		}
	}
	
	process() {
		this.learn();
		this.unbiasnet();
		this.inxbuild();
		return this.colorMap();
	}
	
	colorMap() {
		const map = [];
		const index = [];
		for (let i = 0; i < this.netsize; i++) index[this.network[i][3]] = i;
		for (let i = 0; i < this.netsize; i++) {
			const j = index[i];
			map.push(this.network[j][2], this.network[j][1], this.network[j][0]);
		}
		return map;
	}
	
	inxbuild() {
		let previouscol = 0, startpos = 0;
		for (let i = 0; i < this.netsize; i++) {
			const p = this.network[i];
			let smallpos = i, smallval = p[1];
			for (let j = i + 1; j < this.netsize; j++) {
				const q = this.network[j];
				if (q[1] < smallval) { smallpos = j; smallval = q[1]; }
			}
			const q = this.network[smallpos];
			if (i !== smallpos) {
				[p[0], q[0]] = [q[0], p[0]];
				[p[1], q[1]] = [q[1], p[1]];
				[p[2], q[2]] = [q[2], p[2]];
				[p[3], q[3]] = [q[3], p[3]];
			}
			if (smallval !== previouscol) {
				this.netindex[previouscol] = (startpos + i) >> 1;
				for (let j = previouscol + 1; j < smallval; j++) this.netindex[j] = i;
				previouscol = smallval;
				startpos = i;
			}
		}
		this.netindex[previouscol] = (startpos + 255) >> 1;
		for (let j = previouscol + 1; j < 256; j++) this.netindex[j] = 255;
	}
	
	learn() {
		const lengthcount = this.pixels.length / 3;
		const alphadec = 30 + ((this.sample - 1) / 3);
		const samplepixels = lengthcount / this.sample;
		let delta = Math.max(1, samplepixels / 100);
		let alpha = 1024;
		let radius = 32 * 256;
		let rad = radius >> 6;
		
		for (let i = 0; i < rad; i++) this.radpower[i] = alpha * (((rad * rad - i * i) * 256) / (rad * rad));
		
		let step = lengthcount < 500 ? 3 : lengthcount < 2500 ? 1 : lengthcount < 25000 ? 3 : 5;
		let pix = 0;
		
		for (let i = 0; i < samplepixels; ) {
			const b = this.pixels[pix] << 4;
			const g = this.pixels[pix + 1] << 4;
			const r = this.pixels[pix + 2] << 4;
			let j = this.contest(b, g, r);
			this.altersingle(alpha, j, b, g, r);
			if (rad !== 0) this.alterneigh(rad, j, b, g, r);
			pix += step * 3;
			if (pix >= lengthcount * 3) pix -= lengthcount * 3;
			i++;
			if (delta === 0) delta = 1;
			if (i % delta === 0) {
				alpha -= alpha / alphadec;
				radius -= radius / 30;
				rad = radius >> 6;
				if (rad <= 1) rad = 0;
				for (let k = 0; k < rad; k++) this.radpower[k] = alpha * (((rad * rad - k * k) * 256) / (rad * rad));
			}
		}
	}
	
	map(b, g, r) {
		let bestd = 1000, best = -1;
		let i = this.netindex[g];
		let j = i - 1;
		while (i < this.netsize || j >= 0) {
			if (i < this.netsize) {
				const p = this.network[i];
				let dist = p[1] - g;
				if (dist >= bestd) i = this.netsize;
				else {
					i++;
					if (dist < 0) dist = -dist;
					let a = p[0] - b; if (a < 0) a = -a; dist += a;
					if (dist < bestd) { a = p[2] - r; if (a < 0) a = -a; dist += a; if (dist < bestd) { bestd = dist; best = p[3]; } }
				}
			}
			if (j >= 0) {
				const p = this.network[j];
				let dist = g - p[1];
				if (dist >= bestd) j = -1;
				else {
					j--;
					if (dist < 0) dist = -dist;
					let a = p[0] - b; if (a < 0) a = -a; dist += a;
					if (dist < bestd) { a = p[2] - r; if (a < 0) a = -a; dist += a; if (dist < bestd) { bestd = dist; best = p[3]; } }
				}
			}
		}
		return best;
	}
	
	unbiasnet() {
		for (let i = 0; i < this.netsize; i++) {
			this.network[i][0] >>= 4;
			this.network[i][1] >>= 4;
			this.network[i][2] >>= 4;
			this.network[i][3] = i;
		}
	}
	
	contest(b, g, r) {
		let bestd = ~(1 << 31), bestbiasd = bestd, bestpos = -1, bestbiaspos = bestpos;
		for (let i = 0; i < this.netsize; i++) {
			const n = this.network[i];
			let dist = Math.abs(n[0] - b) + Math.abs(n[1] - g) + Math.abs(n[2] - r);
			if (dist < bestd) { bestd = dist; bestpos = i; }
			const biasdist = dist - ((this.bias[i]) >> 12);
			if (biasdist < bestbiasd) { bestbiasd = biasdist; bestbiaspos = i; }
			const betafreq = this.freq[i] >> 10;
			this.freq[i] -= betafreq;
			this.bias[i] += betafreq << 10;
		}
		this.freq[bestpos] += 64;
		this.bias[bestpos] -= 65536;
		return bestbiaspos;
	}
	
	altersingle(alpha, i, b, g, r) {
		const n = this.network[i];
		n[0] -= (alpha * (n[0] - b)) >> 10;
		n[1] -= (alpha * (n[1] - g)) >> 10;
		n[2] -= (alpha * (n[2] - r)) >> 10;
	}
	
	alterneigh(rad, i, b, g, r) {
		let lo = Math.max(i - rad, -1);
		let hi = Math.min(i + rad, this.netsize);
		let j = i + 1, k = i - 1, m = 1;
		while (j < hi || k > lo) {
			const a = this.radpower[m++];
			if (j < hi) {
				const p = this.network[j++];
				p[0] -= (a * (p[0] - b)) >> 18;
				p[1] -= (a * (p[1] - g)) >> 18;
				p[2] -= (a * (p[2] - r)) >> 18;
			}
			if (k > lo) {
				const p = this.network[k--];
				p[0] -= (a * (p[0] - b)) >> 18;
				p[1] -= (a * (p[1] - g)) >> 18;
				p[2] -= (a * (p[2] - r)) >> 18;
			}
		}
	}
}

// LZW Encoder
class LZWEncoder {
	constructor(width, height, pixels, colorDepth) {
		this.width = width;
		this.height = height;
		this.pixels = pixels;
		this.colorDepth = Math.max(2, colorDepth);
		this.initCodeSize = this.colorDepth;
		this.accum = new Uint8Array(256);
		this.htab = new Int32Array(5003);
		this.codetab = new Int32Array(5003);
	}
	
	encode(outs) {
		outs.writeByte(this.initCodeSize);
		this.remaining = this.width * this.height;
		this.curPixel = 0;
		this.compress(this.initCodeSize + 1, outs);
		outs.writeByte(0);
	}
	
	compress(initBits, outs) {
		let fcode, c, ent, hshift, disp;
		const hsize = 5003;
		const clearCode = 1 << (initBits - 1);
		const eofCode = clearCode + 1;
		let freeEnt = clearCode + 2;
		let aCount = 0;
		let nBits = initBits;
		let maxcode = (1 << nBits) - 1;
		
		for (let i = 0; i < hsize; i++) this.htab[i] = -1;
		
		let curAccum = 0, curBits = 0;
		
		const output = (code) => {
			curAccum &= (1 << curBits) - 1;
			curAccum = curBits > 0 ? curAccum | (code << curBits) : code;
			curBits += nBits;
			while (curBits >= 8) {
				this.accum[aCount++] = curAccum & 0xFF;
				if (aCount >= 254) { outs.writeByte(aCount); outs.writeBytes(Array.from(this.accum.slice(0, aCount))); aCount = 0; }
				curAccum >>= 8;
				curBits -= 8;
			}
		};
		
		const clBlock = () => {
			for (let i = 0; i < hsize; i++) this.htab[i] = -1;
			freeEnt = clearCode + 2;
			output(clearCode);
			nBits = initBits;
			maxcode = (1 << nBits) - 1;
		};
		
		ent = this.nextPixel();
		hshift = 0;
		for (fcode = hsize; fcode < 65536; fcode *= 2) hshift++;
		hshift = 8 - hshift;
		
		output(clearCode);
		
		while ((c = this.nextPixel()) !== -1) {
			fcode = (c << 12) + ent;
			let i = (c << hshift) ^ ent;
			if (this.htab[i] === fcode) { ent = this.codetab[i]; continue; }
			if (this.htab[i] >= 0) {
				disp = hsize - i;
				if (i === 0) disp = 1;
				do { if ((i -= disp) < 0) i += hsize; if (this.htab[i] === fcode) { ent = this.codetab[i]; break; } } while (this.htab[i] >= 0);
				if (this.htab[i] === fcode) continue;
			}
			output(ent);
			ent = c;
			if (freeEnt < 4096) {
				this.codetab[i] = freeEnt++;
				this.htab[i] = fcode;
				if (freeEnt > maxcode && nBits < 12) {
					nBits++;
					maxcode = (1 << nBits) - 1;
				}
			} else clBlock();
		}
		
		output(ent);
		output(eofCode);
		
		if (curBits > 0) {
			this.accum[aCount++] = curAccum & 0xFF;
		}
		if (aCount > 0) { outs.writeByte(aCount); outs.writeBytes(Array.from(this.accum.slice(0, aCount))); }
	}
	
	nextPixel() {
		if (this.remaining === 0) return -1;
		this.remaining--;
		return this.pixels[this.curPixel++] & 0xFF;
	}
}
