

//this file is sourcemap-codec and magic string from the svelte guy

var DEBUG = false

export type SourceMapSegment =
	| [number]
	| [number, number, number, number]
	| [number, number, number, number, number];
export type SourceMapLine = SourceMapSegment[];
export type SourceMapMappings = SourceMapLine[];

const charToInteger: { [charCode: number]: number } = {};
const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

for (let i = 0; i < chars.length; i++) {
	charToInteger[chars.charCodeAt(i)] = i;
}

export function decode(mappings: string): SourceMapMappings {
	let generatedCodeColumn = 0; // first field
	let sourceFileIndex = 0;     // second field
	let sourceCodeLine = 0;      // third field
	let sourceCodeColumn = 0;    // fourth field
	let nameIndex = 0;           // fifth field

	const decoded: SourceMapMappings = [];
	let line: SourceMapLine = [];
	let segment: number[] = [];

	for (let i = 0, j = 0, shift = 0, value = 0, len = mappings.length; i < len; i++) {
		const c = mappings.charCodeAt(i);

		if (c === 44) { // ","
			if (segment.length) line.push(segment as SourceMapSegment);
			segment = [];
			j = 0;

		} else if (c === 59) { // ";"
			if (segment.length) line.push(segment as SourceMapSegment);
			segment = [];
			j = 0;
			decoded.push(line);
			line = [];
			generatedCodeColumn = 0;

		} else {
			let integer = charToInteger[c];
			if (integer === undefined) {
				throw new Error('Invalid character (' + String.fromCharCode(c) + ')');
			}

			const hasContinuationBit = integer & 32;

			integer &= 31;
			value += integer << shift;

			if (hasContinuationBit) {
				shift += 5;
			} else {
				const shouldNegate = value & 1;
				value >>>= 1;

				if (shouldNegate) {
					value = -value;
					if (value === 0) value = -0x80000000;
				}

				if (j == 0) {
					generatedCodeColumn += value;
					segment.push(generatedCodeColumn);

				} else if (j === 1) {
					sourceFileIndex += value;
					segment.push(sourceFileIndex);

				} else if (j === 2) {
					sourceCodeLine += value;
					segment.push(sourceCodeLine);

				} else if (j === 3) {
					sourceCodeColumn += value;
					segment.push(sourceCodeColumn);

				} else if (j === 4) {
					nameIndex += value;
					segment.push(nameIndex);
				}

				j++;
				value = shift = 0; // reset
			}
		}
	}

	if (segment.length) line.push(segment as SourceMapSegment);
	decoded.push(line);

	return decoded;
}

export function encode(decoded: SourceMapMappings): string {
	let sourceFileIndex = 0;  // second field
	let sourceCodeLine = 0;   // third field
	let sourceCodeColumn = 0; // fourth field
	let nameIndex = 0;        // fifth field
	let mappings = '';

	for (let i = 0; i < decoded.length; i++) {
		const line = decoded[i];
		if (i > 0) mappings += ';';
		if (line.length === 0) continue;

		let generatedCodeColumn = 0; // first field

		const lineMappings: string[] = [];

		for (const segment of line) {
			let segmentMappings = encodeInteger(segment[0] - generatedCodeColumn);
			generatedCodeColumn = segment[0];

			if (segment.length > 1) {
				segmentMappings +=
					encodeInteger(segment[1] - sourceFileIndex) +
					encodeInteger(segment[2] - sourceCodeLine) +
					encodeInteger(segment[3] - sourceCodeColumn);

				sourceFileIndex = segment[1];
				sourceCodeLine = segment[2];
				sourceCodeColumn = segment[3];
			}

			if (segment.length === 5) {
				segmentMappings += encodeInteger(segment[4] - nameIndex);
				nameIndex = segment[4];
			}

			lineMappings.push(segmentMappings);
		}

		mappings += lineMappings.join(',');
	}

	return mappings;
}

function encodeInteger(num: number): string {
	var result = '';
	num = num < 0 ? (-num << 1) | 1 : num << 1;
	do {
		var clamped = num & 31;
		num >>>= 5;
		if (num > 0) {
			clamped |= 32;
		}
		result += chars[clamped];
	} while (num > 0);

	return result;
}

const n = '\n';

const warned = {
	insertLeft: false,
	insertRight: false,
	storeName: false
};

class MagicString {
	byStart: any;
	byEnd: any;
	sourcemapLocations: any;
	outro: string;
	stats: any;
	intro: string;
	original: any;
	filename: any;
	firstChunk: any;
	lastSearchedChunk: any;
	lastChunk: any;
	indentExclusionRanges: any;
	indentStr: any;
	static Bundle: typeof Bundle;
	static default: typeof MagicString;
	constructor(string, options: any = {}) {
		const chunk = new Chunk(0, string.length, string);

		Object.defineProperties(this, {
			original:              { writable: true, value: string },
			outro:                 { writable: true, value: '' },
			intro:                 { writable: true, value: '' },
			firstChunk:            { writable: true, value: chunk },
			lastChunk:             { writable: true, value: chunk },
			lastSearchedChunk:     { writable: true, value: chunk },
			byStart:               { writable: true, value: {} },
			byEnd:                 { writable: true, value: {} },
			filename:              { writable: true, value: options.filename },
			indentExclusionRanges: { writable: true, value: options.indentExclusionRanges },
			sourcemapLocations:    { writable: true, value: {} },
			storedNames:           { writable: true, value: {} },
			indentStr:             { writable: true, value: guessIndent(string) }
		});

		if (DEBUG) {
			Object.defineProperty(this, 'stats', { value: new Stats() });
		}

		this.byStart[0] = chunk;
		this.byEnd[string.length] = chunk;
	}

	addSourcemapLocation(char) {
		this.sourcemapLocations[char] = true;
	}

	append(content) {
		if (typeof content !== 'string') throw new TypeError('outro content must be a string');

		this.outro += content;
		return this;
	}

	appendLeft(index, content) {
		if (typeof content !== 'string') throw new TypeError('inserted content must be a string');

		if (DEBUG) this.stats.time('appendLeft');

		this._split(index);

		const chunk = this.byEnd[index];

		if (chunk) {
			chunk.appendLeft(content);
		} else {
			this.intro += content;
		}

		if (DEBUG) this.stats.timeEnd('appendLeft');
		return this;
	}

	appendRight(index, content) {
		if (typeof content !== 'string') throw new TypeError('inserted content must be a string');

		if (DEBUG) this.stats.time('appendRight');

		this._split(index);

		const chunk = this.byStart[index];

		if (chunk) {
			chunk.appendRight(content);
		} else {
			this.outro += content;
		}

		if (DEBUG) this.stats.timeEnd('appendRight');
		return this;
	}

	clone() {
		const cloned = new MagicString(this.original, { filename: this.filename });

		let originalChunk = this.firstChunk;
		let clonedChunk = (cloned.firstChunk = cloned.lastSearchedChunk = originalChunk.clone());

		while (originalChunk) {
			cloned.byStart[clonedChunk.start] = clonedChunk;
			cloned.byEnd[clonedChunk.end] = clonedChunk;

			const nextOriginalChunk = originalChunk.next;
			const nextClonedChunk = nextOriginalChunk && nextOriginalChunk.clone();

			if (nextClonedChunk) {
				clonedChunk.next = nextClonedChunk;
				nextClonedChunk.previous = clonedChunk;

				clonedChunk = nextClonedChunk;
			}

			originalChunk = nextOriginalChunk;
		}

		cloned.lastChunk = clonedChunk;

		if (this.indentExclusionRanges) {
			cloned.indentExclusionRanges = this.indentExclusionRanges.slice();
		}

		Object.keys(this.sourcemapLocations).forEach(loc => {
			cloned.sourcemapLocations[loc] = true;
		});

		return cloned;
	}

	generateDecodedMap(options) {
		options = options || {};

		const sourceIndex = 0;
		const names = Object.keys(this.storedNames);
		const mappings = new Mappings(options.hires);

		const locate = getLocator(this.original);

		if (this.intro) {
			mappings.advance(this.intro);
		}

		this.firstChunk.eachNext(chunk => {
			const loc = locate(chunk.start);

			if (chunk.intro.length) mappings.advance(chunk.intro);

			if (chunk.edited) {
				mappings.addEdit(
					sourceIndex,
					chunk.content,
					loc,
					chunk.storeName ? names.indexOf(chunk.original) : -1
				);
			} else {
				mappings.addUneditedChunk(sourceIndex, chunk, this.original, loc, this.sourcemapLocations);
			}

			if (chunk.outro.length) mappings.advance(chunk.outro);
		});

		return {
			file: options.file ? options.file.split(/[/\\]/).pop() : null,
			sources: [options.source ? getRelativePath(options.file || '', options.source) : null],
			sourcesContent: options.includeContent ? [this.original] : [null],
			names,
			mappings: mappings.raw
		};
	}
	storedNames(storedNames: any) {
		throw new Error("Method not implemented.");
	}

	generateMap(options) {
		return new SourceMap(this.generateDecodedMap(options));
	}

	getIndentString() {
		return this.indentStr === null ? '\t' : this.indentStr;
	}

	indent(indentStr, options) {
		const pattern = /^[^\r\n]/gm;

		if (isObject(indentStr)) {
			options = indentStr;
			indentStr = undefined;
		}

		indentStr = indentStr !== undefined ? indentStr : this.indentStr || '\t';

		if (indentStr === '') return this; // noop

		options = options || {};

		// Process exclusion ranges
		const isExcluded = {};

		if (options.exclude) {
			const exclusions =
				typeof options.exclude[0] === 'number' ? [options.exclude] : options.exclude;
			exclusions.forEach(exclusion => {
				for (let i = exclusion[0]; i < exclusion[1]; i += 1) {
					isExcluded[i] = true;
				}
			});
		}

		let shouldIndentNextCharacter = options.indentStart !== false;
		const replacer = match => {
			if (shouldIndentNextCharacter) return `${indentStr}${match}`;
			shouldIndentNextCharacter = true;
			return match;
		};

		this.intro = this.intro.replace(pattern, replacer);

		let charIndex = 0;
		let chunk = this.firstChunk;

		while (chunk) {
			const end = chunk.end;

			if (chunk.edited) {
				if (!isExcluded[charIndex]) {
					chunk.content = chunk.content.replace(pattern, replacer);

					if (chunk.content.length) {
						shouldIndentNextCharacter = chunk.content[chunk.content.length - 1] === '\n';
					}
				}
			} else {
				charIndex = chunk.start;

				while (charIndex < end) {
					if (!isExcluded[charIndex]) {
						const char = this.original[charIndex];

						if (char === '\n') {
							shouldIndentNextCharacter = true;
						} else if (char !== '\r' && shouldIndentNextCharacter) {
							shouldIndentNextCharacter = false;

							if (charIndex === chunk.start) {
								chunk.prependRight(indentStr);
							} else {
								this._splitChunk(chunk, charIndex);
								chunk = chunk.next;
								chunk.prependRight(indentStr);
							}
						}
					}

					charIndex += 1;
				}
			}

			charIndex = chunk.end;
			chunk = chunk.next;
		}

		this.outro = this.outro.replace(pattern, replacer);

		return this;
	}

	insert() {
		throw new Error('magicString.insert(...) is deprecated. Use prependRight(...) or appendLeft(...)');
	}

	insertLeft(index, content) {
		if (!warned.insertLeft) {
			console.warn('magicString.insertLeft(...) is deprecated. Use magicString.appendLeft(...) instead'); // eslint-disable-line no-console
			warned.insertLeft = true;
		}

		return this.appendLeft(index, content);
	}

	insertRight(index, content) {
		if (!warned.insertRight) {
			console.warn('magicString.insertRight(...) is deprecated. Use magicString.prependRight(...) instead'); // eslint-disable-line no-console
			warned.insertRight = true;
		}

		return this.prependRight(index, content);
	}

	move(start, end, index) {
		if (index >= start && index <= end) throw new Error('Cannot move a selection inside itself');

		if (DEBUG) this.stats.time('move');

		this._split(start);
		this._split(end);
		this._split(index);

		const first = this.byStart[start];
		const last = this.byEnd[end];

		const oldLeft = first.previous;
		const oldRight = last.next;

		const newRight = this.byStart[index];
		if (!newRight && last === this.lastChunk) return this;
		const newLeft = newRight ? newRight.previous : this.lastChunk;

		if (oldLeft) oldLeft.next = oldRight;
		if (oldRight) oldRight.previous = oldLeft;

		if (newLeft) newLeft.next = first;
		if (newRight) newRight.previous = last;

		if (!first.previous) this.firstChunk = last.next;
		if (!last.next) {
			this.lastChunk = first.previous;
			this.lastChunk.next = null;
		}

		first.previous = newLeft;
		last.next = newRight || null;

		if (!newLeft) this.firstChunk = first;
		if (!newRight) this.lastChunk = last;

		if (DEBUG) this.stats.timeEnd('move');
		return this;
	}

	overwrite(start, end, content, options) {
		if (typeof content !== 'string') throw new TypeError('replacement content must be a string');

		while (start < 0) start += this.original.length;
		while (end < 0) end += this.original.length;

		if (end > this.original.length) throw new Error('end is out of bounds');
		if (start === end)
			throw new Error('Cannot overwrite a zero-length range – use appendLeft or prependRight instead');

		if (DEBUG) this.stats.time('overwrite');

		this._split(start);
		this._split(end);

		if (options === true) {
			if (!warned.storeName) {
				console.warn('The final argument to magicString.overwrite(...) should be an options object. See https://github.com/rich-harris/magic-string'); // eslint-disable-line no-console
				warned.storeName = true;
			}

			options = { storeName: true };
		}
		const storeName = options !== undefined ? options.storeName : false;
		const contentOnly = options !== undefined ? options.contentOnly : false;

		if (storeName) {
			const original = this.original.slice(start, end);
			this.storedNames[original] = true;
		}

		const first = this.byStart[start];
		const last = this.byEnd[end];

		if (first) {
			if (end > first.end && first.next !== this.byStart[first.end]) {
				throw new Error('Cannot overwrite across a split point');
			}

			first.edit(content, storeName, contentOnly);

			if (first !== last) {
				let chunk = first.next;
				while (chunk !== last) {
					chunk.edit('', false);
					chunk = chunk.next;
				}

				chunk.edit('', false);
			}
		} else {
			// must be inserting at the end
			const newChunk = new Chunk(start, end, '').edit(content, storeName);

			// TODO last chunk in the array may not be the last chunk, if it's moved...
			last.next = newChunk;
			newChunk.previous = last;
		}

		if (DEBUG) this.stats.timeEnd('overwrite');
		return this;
	}

	prepend(content) {
		if (typeof content !== 'string') throw new TypeError('outro content must be a string');

		this.intro = content + this.intro;
		return this;
	}

	prependLeft(index, content) {
		if (typeof content !== 'string') throw new TypeError('inserted content must be a string');

		if (DEBUG) this.stats.time('insertRight');

		this._split(index);

		const chunk = this.byEnd[index];

		if (chunk) {
			chunk.prependLeft(content);
		} else {
			this.intro = content + this.intro;
		}

		if (DEBUG) this.stats.timeEnd('insertRight');
		return this;
	}

	prependRight(index, content) {
		if (typeof content !== 'string') throw new TypeError('inserted content must be a string');

		if (DEBUG) this.stats.time('insertRight');

		this._split(index);

		const chunk = this.byStart[index];

		if (chunk) {
			chunk.prependRight(content);
		} else {
			this.outro = content + this.outro;
		}

		if (DEBUG) this.stats.timeEnd('insertRight');
		return this;
	}

	remove(start, end) {
		while (start < 0) start += this.original.length;
		while (end < 0) end += this.original.length;

		if (start === end) return this;

		if (start < 0 || end > this.original.length) throw new Error('Character is out of bounds');
		if (start > end) throw new Error('end must be greater than start');

		if (DEBUG) this.stats.time('remove');

		this._split(start);
		this._split(end);

		let chunk = this.byStart[start];

		while (chunk) {
			chunk.intro = '';
			chunk.outro = '';
			chunk.edit('');

			chunk = end > chunk.end ? this.byStart[chunk.end] : null;
		}

		if (DEBUG) this.stats.timeEnd('remove');
		return this;
	}

	lastChar() {
		if (this.outro.length)
			return this.outro[this.outro.length - 1];
		let chunk = this.lastChunk;
		do {
			if (chunk.outro.length)
				return chunk.outro[chunk.outro.length - 1];
			if (chunk.content.length)
				return chunk.content[chunk.content.length - 1];
			if (chunk.intro.length)
				return chunk.intro[chunk.intro.length - 1];
		} while (chunk = chunk.previous);
		if (this.intro.length)
			return this.intro[this.intro.length - 1];
		return '';
	}

	lastLine() {
		let lineIndex = this.outro.lastIndexOf(n);
		if (lineIndex !== -1)
			return this.outro.substr(lineIndex + 1);
		let lineStr = this.outro;
		let chunk = this.lastChunk;
		do {
			if (chunk.outro.length > 0) {
				lineIndex = chunk.outro.lastIndexOf(n);
				if (lineIndex !== -1)
					return chunk.outro.substr(lineIndex + 1) + lineStr;
				lineStr = chunk.outro + lineStr;
			}

			if (chunk.content.length > 0) {
				lineIndex = chunk.content.lastIndexOf(n);
				if (lineIndex !== -1)
					return chunk.content.substr(lineIndex + 1) + lineStr;
				lineStr = chunk.content + lineStr;
			}

			if (chunk.intro.length > 0) {
				lineIndex = chunk.intro.lastIndexOf(n);
				if (lineIndex !== -1)
					return chunk.intro.substr(lineIndex + 1) + lineStr;
				lineStr = chunk.intro + lineStr;
			}
		} while (chunk = chunk.previous);
		lineIndex = this.intro.lastIndexOf(n);
		if (lineIndex !== -1)
			return this.intro.substr(lineIndex + 1) + lineStr;
		return this.intro + lineStr;
	}

	slice(start = 0, end = this.original.length) {
		while (start < 0) start += this.original.length;
		while (end < 0) end += this.original.length;

		let result = '';

		// find start chunk
		let chunk = this.firstChunk;
		while (chunk && (chunk.start > start || chunk.end <= start)) {
			// found end chunk before start
			if (chunk.start < end && chunk.end >= end) {
				return result;
			}

			chunk = chunk.next;
		}

		if (chunk && chunk.edited && chunk.start !== start)
			throw new Error(`Cannot use replaced character ${start} as slice start anchor.`);

		const startChunk = chunk;
		while (chunk) {
			if (chunk.intro && (startChunk !== chunk || chunk.start === start)) {
				result += chunk.intro;
			}

			const containsEnd = chunk.start < end && chunk.end >= end;
			if (containsEnd && chunk.edited && chunk.end !== end)
				throw new Error(`Cannot use replaced character ${end} as slice end anchor.`);

			const sliceStart = startChunk === chunk ? start - chunk.start : 0;
			const sliceEnd = containsEnd ? chunk.content.length + end - chunk.end : chunk.content.length;

			result += chunk.content.slice(sliceStart, sliceEnd);

			if (chunk.outro && (!containsEnd || chunk.end === end)) {
				result += chunk.outro;
			}

			if (containsEnd) {
				break;
			}

			chunk = chunk.next;
		}

		return result;
	}

	// TODO deprecate this? not really very useful
	snip(start, end) {
		const clone = this.clone();
		clone.remove(0, start);
		clone.remove(end, clone.original.length);

		return clone;
	}

	_split(index) {
		if (this.byStart[index] || this.byEnd[index]) return;

		if (DEBUG) this.stats.time('_split');

		let chunk = this.lastSearchedChunk;
		const searchForward = index > chunk.end;

		while (chunk) {
			if (chunk.contains(index)) return this._splitChunk(chunk, index);

			chunk = searchForward ? this.byStart[chunk.end] : this.byEnd[chunk.start];
		}
	}

	_splitChunk(chunk, index) {
		if (chunk.edited && chunk.content.length) {
			// zero-length edited chunks are a special case (overlapping replacements)
			const loc = getLocator(this.original)(index);
			throw new Error(
				`Cannot split a chunk that has already been edited (${loc.line}:${loc.column} – "${
					chunk.original
				}")`
			);
		}

		const newChunk = chunk.split(index);

		this.byEnd[index] = chunk;
		this.byStart[index] = newChunk;
		this.byEnd[newChunk.end] = newChunk;

		if (chunk === this.lastChunk) this.lastChunk = newChunk;

		this.lastSearchedChunk = chunk;
		if (DEBUG) this.stats.timeEnd('_split');
		return true;
	}

	toString() {
		let str = this.intro;

		let chunk = this.firstChunk;
		while (chunk) {
			str += chunk.toString();
			chunk = chunk.next;
		}

		return str + this.outro;
	}

	isEmpty() {
		let chunk = this.firstChunk;
		do {
			if (chunk.intro.length && chunk.intro.trim() ||
					chunk.content.length && chunk.content.trim() ||
					chunk.outro.length && chunk.outro.trim())
				return false;
		} while (chunk = chunk.next);
		return true;
	}

	length() {
		let chunk = this.firstChunk;
		let length = 0;
		do {
			length += chunk.intro.length + chunk.content.length + chunk.outro.length;
		} while (chunk = chunk.next);
		return length;
	}

	trimLines() {
		return this.trim('[\\r\\n]');
	}

	trim(charType) {
		return this.trimStart(charType).trimEnd(charType);
	}

	trimEndAborted(charType) {
		const rx = new RegExp((charType || '\\s') + '+$');

		this.outro = this.outro.replace(rx, '');
		if (this.outro.length) return true;

		let chunk = this.lastChunk;

		do {
			const end = chunk.end;
			const aborted = chunk.trimEnd(rx);

			// if chunk was trimmed, we have a new lastChunk
			if (chunk.end !== end) {
				if (this.lastChunk === chunk) {
					this.lastChunk = chunk.next;
				}

				this.byEnd[chunk.end] = chunk;
				this.byStart[chunk.next.start] = chunk.next;
				this.byEnd[chunk.next.end] = chunk.next;
			}

			if (aborted) return true;
			chunk = chunk.previous;
		} while (chunk);

		return false;
	}

	trimEnd(charType) {
		this.trimEndAborted(charType);
		return this;
	}
	trimStartAborted(charType) {
		const rx = new RegExp('^' + (charType || '\\s') + '+');

		this.intro = this.intro.replace(rx, '');
		if (this.intro.length) return true;

		let chunk = this.firstChunk;

		do {
			const end = chunk.end;
			const aborted = chunk.trimStart(rx);

			if (chunk.end !== end) {
				// special case...
				if (chunk === this.lastChunk) this.lastChunk = chunk.next;

				this.byEnd[chunk.end] = chunk;
				this.byStart[chunk.next.start] = chunk.next;
				this.byEnd[chunk.next.end] = chunk.next;
			}

			if (aborted) return true;
			chunk = chunk.next;
		} while (chunk);

		return false;
	}

	trimStart(charType) {
		this.trimStartAborted(charType);
		return this;
	}
}


export class Chunk {
	previous: any;
	start: any;
	end: any;
	original: any;
	intro: string;
	outro: string;
	content: any;
	storeName: boolean;
	edited: boolean;
	next: this;
	constructor(start, end, content) {
		this.start = start;
		this.end = end;
		this.original = content;

		this.intro = '';
		this.outro = '';

		this.content = content;
		this.storeName = false;
		this.edited = false;

		// we make these non-enumerable, for sanity while debugging
		Object.defineProperties(this, {
			previous: { writable: true, value: null },
			next:     { writable: true, value: null }
		});
	}

	appendLeft(content) {
		this.outro += content;
	}

	appendRight(content) {
		this.intro = this.intro + content;
	}

	clone() {
		const chunk = new Chunk(this.start, this.end, this.original);

		chunk.intro = this.intro;
		chunk.outro = this.outro;
		chunk.content = this.content;
		chunk.storeName = this.storeName;
		chunk.edited = this.edited;

		return chunk;
	}

	contains(index) {
		return this.start < index && index < this.end;
	}

	eachNext(fn) {
		let chunk = this;
		while (chunk) {
			fn(chunk);
			chunk = chunk.next;
		}
	}

	eachPrevious(fn) {
		let chunk = this;
		while (chunk) {
			fn(chunk);
			chunk = chunk.previous;
		}
	}

	edit(content, storeName, contentOnly?) {
		this.content = content;
		if (!contentOnly) {
			this.intro = '';
			this.outro = '';
		}
		this.storeName = storeName;

		this.edited = true;

		return this;
	}

	prependLeft(content) {
		this.outro = content + this.outro;
	}

	prependRight(content) {
		this.intro = content + this.intro;
	}

	split(index) {
		const sliceIndex = index - this.start;

		const originalBefore = this.original.slice(0, sliceIndex);
		const originalAfter = this.original.slice(sliceIndex);

		this.original = originalBefore;

		const newChunk = new Chunk(index, this.end, originalAfter);
		newChunk.outro = this.outro;
		this.outro = '';

		this.end = index;

		if (this.edited) {
			// TODO is this block necessary?...
			newChunk.edit('', false);
			this.content = '';
		} else {
			this.content = originalBefore;
		}

		newChunk.next = this.next;
		if (newChunk.next) newChunk.next.previous = newChunk;
		newChunk.previous = this;

		//@ts-ignore
		this.next = newChunk;

		return newChunk;
	}

	toString() {
		return this.intro + this.content + this.outro;
	}

	trimEnd(rx) {
		this.outro = this.outro.replace(rx, '');
		if (this.outro.length) return true;

		const trimmed = this.content.replace(rx, '');

		if (trimmed.length) {
			if (trimmed !== this.content) {
				this.split(this.start + trimmed.length).edit('', undefined, true);
			}
			return true;

		} else {
			this.edit('', undefined, true);

			this.intro = this.intro.replace(rx, '');
			if (this.intro.length) return true;
		}
	}

	trimStart(rx) {
		this.intro = this.intro.replace(rx, '');
		if (this.intro.length) return true;

		const trimmed = this.content.replace(rx, '');

		if (trimmed.length) {
			if (trimmed !== this.content) {
				this.split(this.end - trimmed.length);
				this.edit('', undefined, true);
			}
			return true;

		} else {
			this.edit('', undefined, true);

			this.outro = this.outro.replace(rx, '');
			if (this.outro.length) return true;
		}
	}
}

function getLocator(source) {
	const originalLines = source.split('\n');
	const lineOffsets = [];

	for (let i = 0, pos = 0; i < originalLines.length; i++) {
		lineOffsets.push(pos);
		pos += originalLines[i].length + 1;
	}

	return function locate(index) {
		let i = 0;
		let j = lineOffsets.length;
		while (i < j) {
			const m = (i + j) >> 1;
			if (index < lineOffsets[m]) {
				j = m;
			} else {
				i = m + 1;
			}
		}
		const line = i - 1;
		const column = index - lineOffsets[line];
		return { line, column };
	};
}

function getRelativePath(from, to) {
	const fromParts = from.split(/[/\\]/);
	const toParts = to.split(/[/\\]/);

	fromParts.pop(); // get dirname

	while (fromParts[0] === toParts[0]) {
		fromParts.shift();
		toParts.shift();
	}

	if (fromParts.length) {
		let i = fromParts.length;
		while (i--) fromParts[i] = '..';
	}

	return fromParts.concat(toParts).join('/');
}

 
function guessIndent(code) {
	const lines = code.split('\n');

	const tabbed = lines.filter(line => /^\t+/.test(line));
	const spaced = lines.filter(line => /^ {2,}/.test(line));

	if (tabbed.length === 0 && spaced.length === 0) {
		return null;
	}

	// More lines tabbed than spaced? Assume tabs, and
	// default to tabs in the case of a tie (or nothing
	// to go on)
	if (tabbed.length >= spaced.length) {
		return '\t';
	}

	// Otherwise, we need to guess the multiple
	const min = spaced.reduce((previous, current) => {
		const numSpaces = /^ +/.exec(current)[0].length;
		return Math.min(numSpaces, previous);
	}, Infinity);

	return new Array(min + 1).join(' ');
}

const toString = Object.prototype.toString;

function isObject(thing) {
	return toString.call(thing) === '[object Object]';
}



let btoa: any
btoa = () => {
	throw new Error('Unsupported environment: `window.btoa` or `Buffer` should be supported.');
};

if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
	//@ts-ignore
	btoa = str => window.btoa(unescape(encodeURIComponent(str)));
} else if (typeof Buffer === 'function') {
	//@ts-ignore
	btoa = str => Buffer.from(str, 'utf-8').toString('base64');
}

class SourceMap {
	version: number;
	file: any;
	sources: any;
	sourcesContent: any;
	names: any;
	mappings: string;
	constructor(properties) {
		this.version = 3;
		this.file = properties.file;
		this.sources = properties.sources;
		this.sourcesContent = properties.sourcesContent;
		this.names = properties.names;
		this.mappings = encode(properties.mappings);
	}

	toString() {
		return JSON.stringify(this);
	}

	toUrl() {
		return 'data:application/json;charset=utf-8;base64,' + btoa(this.toString());
	}
}

class Stats {
	startTimes: any;
	constructor() {
		Object.defineProperties(this, {
			startTimes: { value: {} }
		});
	}

	time(label) {
		this.startTimes[label] = process.hrtime();
	}

	timeEnd(label) {
		const elapsed = process.hrtime(this.startTimes[label]);

		if (!this[label]) this[label] = 0;
		this[label] += elapsed[0] * 1e3 + elapsed[1] * 1e-6;
	}
}


class Mappings {
	raw: any;
	hires: any;
	generatedCodeLine: number;
	generatedCodeColumn: number;
	rawSegments: any[];
	pending: any;
	constructor(hires) {
		this.hires = hires;
		this.generatedCodeLine = 0;
		this.generatedCodeColumn = 0;
		this.raw = [];
		this.rawSegments = this.raw[this.generatedCodeLine] = [];
		this.pending = null;
	}

	addEdit(sourceIndex, content, loc, nameIndex) {
		if (content.length) {
			const segment = [this.generatedCodeColumn, sourceIndex, loc.line, loc.column];
			if (nameIndex >= 0) {
				segment.push(nameIndex);
			}
			this.rawSegments.push(segment);
		} else if (this.pending) {
			this.rawSegments.push(this.pending);
		}

		this.advance(content);
		this.pending = null;
	}

	addUneditedChunk(sourceIndex, chunk, original, loc, sourcemapLocations) {
		let originalCharIndex = chunk.start;
		let first = true;

		while (originalCharIndex < chunk.end) {
			if (this.hires || first || sourcemapLocations[originalCharIndex]) {
				this.rawSegments.push([this.generatedCodeColumn, sourceIndex, loc.line, loc.column]);
			}

			if (original[originalCharIndex] === '\n') {
				loc.line += 1;
				loc.column = 0;
				this.generatedCodeLine += 1;
				this.raw[this.generatedCodeLine] = this.rawSegments = [];
				this.generatedCodeColumn = 0;
			} else {
				loc.column += 1;
				this.generatedCodeColumn += 1;
			}

			originalCharIndex += 1;
			first = false;
		}

		this.pending = [this.generatedCodeColumn, sourceIndex, loc.line, loc.column];
	}

	advance(str) {
		if (!str) return;

		const lines = str.split('\n');

		if (lines.length > 1) {
			for (let i = 0; i < lines.length - 1; i++) {
				this.generatedCodeLine++;
				this.raw[this.generatedCodeLine] = this.rawSegments = [];
			}
			this.generatedCodeColumn = 0;
		}

		this.generatedCodeColumn += lines[lines.length - 1].length;
	}
}


const hasOwnProp = Object.prototype.hasOwnProperty;


class Bundle {
	intro: any;
	separator: any;
	sources: any[];
	uniqueSources: any[];
	uniqueSourceIndexByFilename: {};
	constructor(options: any = {}) {
		this.intro = options.intro || '';
		this.separator = options.separator !== undefined ? options.separator : '\n';
		this.sources = [];
		this.uniqueSources = [];
		this.uniqueSourceIndexByFilename = {};
	}

	addSource(source) {
		if (source instanceof MagicString) {
			return this.addSource({
				content: source,
				filename: source.filename,
				separator: this.separator
			});
		}

		if (!isObject(source) || !source.content) {
			throw new Error('bundle.addSource() takes an object with a `content` property, which should be an instance of MagicString, and an optional `filename`');
		}

		['filename', 'indentExclusionRanges', 'separator'].forEach(option => {
			if (!hasOwnProp.call(source, option)) source[option] = source.content[option];
		});

		if (source.separator === undefined) {
			// TODO there's a bunch of this sort of thing, needs cleaning up
			source.separator = this.separator;
		}

		if (source.filename) {
			if (!hasOwnProp.call(this.uniqueSourceIndexByFilename, source.filename)) {
				this.uniqueSourceIndexByFilename[source.filename] = this.uniqueSources.length;
				this.uniqueSources.push({ filename: source.filename, content: source.content.original });
			} else {
				const uniqueSource = this.uniqueSources[this.uniqueSourceIndexByFilename[source.filename]];
				if (source.content.original !== uniqueSource.content) {
					throw new Error(`Illegal source: same filename (${source.filename}), different contents`);
				}
			}
		}

		this.sources.push(source);
		return this;
	}

	append(str, options) {
		this.addSource({
			content: new MagicString(str),
			separator: (options && options.separator) || ''
		});

		return this;
	}

	clone() {
		const bundle = new Bundle({
			intro: this.intro,
			separator: this.separator
		});

		this.sources.forEach(source => {
			bundle.addSource({
				filename: source.filename,
				content: source.content.clone(),
				separator: source.separator
			});
		});

		return bundle;
	}

	generateDecodedMap(options: any = {}) {
		const names = [];
		this.sources.forEach(source => {
			Object.keys(source.content.storedNames).forEach(name => {
				if (!~names.indexOf(name)) names.push(name);
			});
		});

		const mappings = new Mappings(options.hires);

		if (this.intro) {
			mappings.advance(this.intro);
		}

		this.sources.forEach((source, i) => {
			if (i > 0) {
				mappings.advance(this.separator);
			}

			const sourceIndex = source.filename ? this.uniqueSourceIndexByFilename[source.filename] : -1;
			const magicString = source.content;
			const locate = getLocator(magicString.original);

			if (magicString.intro) {
				mappings.advance(magicString.intro);
			}

			magicString.firstChunk.eachNext(chunk => {
				const loc = locate(chunk.start);

				if (chunk.intro.length) mappings.advance(chunk.intro);

				if (source.filename) {
					if (chunk.edited) {
						mappings.addEdit(
							sourceIndex,
							chunk.content,
							loc,
							chunk.storeName ? names.indexOf(chunk.original) : -1
						);
					} else {
						mappings.addUneditedChunk(
							sourceIndex,
							chunk,
							magicString.original,
							loc,
							magicString.sourcemapLocations
						);
					}
				} else {
					mappings.advance(chunk.content);
				}

				if (chunk.outro.length) mappings.advance(chunk.outro);
			});

			if (magicString.outro) {
				mappings.advance(magicString.outro);
			}
		});

		return {
			file: options.file ? options.file.split(/[/\\]/).pop() : null,
			sources: this.uniqueSources.map(source => {
				return options.file ? getRelativePath(options.file, source.filename) : source.filename;
			}),
			sourcesContent: this.uniqueSources.map(source => {
				return options.includeContent ? source.content : null;
			}),
			names,
			mappings: mappings.raw
		};
	}

	generateMap(options) {
		return new SourceMap(this.generateDecodedMap(options));
	}

	getIndentString() {
		const indentStringCounts = {};

		this.sources.forEach(source => {
			const indentStr = source.content.indentStr;

			if (indentStr === null) return;

			if (!indentStringCounts[indentStr]) indentStringCounts[indentStr] = 0;
			indentStringCounts[indentStr] += 1;
		});

		return (
			Object.keys(indentStringCounts).sort((a, b) => {
				return indentStringCounts[a] - indentStringCounts[b];
			})[0] || '\t'
		);
	}

	indent(indentStr) {
		if (!arguments.length) {
			indentStr = this.getIndentString();
		}

		if (indentStr === '') return this; // noop

		let trailingNewline = !this.intro || this.intro.slice(-1) === '\n';

		this.sources.forEach((source, i) => {
			const separator = source.separator !== undefined ? source.separator : this.separator;
			const indentStart = trailingNewline || (i > 0 && /\r?\n$/.test(separator));

			source.content.indent(indentStr, {
				exclude: source.indentExclusionRanges,
				indentStart //: trailingNewline || /\r?\n$/.test( separator )  //true///\r?\n/.test( separator )
			});

			trailingNewline = source.content.lastChar() === '\n';
		});

		if (this.intro) {
			this.intro =
				indentStr +
				this.intro.replace(/^[^\n]/gm, (match, index) => {
					return index > 0 ? indentStr + match : match;
				});
		}

		return this;
	}

	prepend(str) {
		this.intro = str + this.intro;
		return this;
	}

	toString() {
		const body = this.sources
			.map((source, i) => {
				const separator = source.separator !== undefined ? source.separator : this.separator;
				const str = (i > 0 ? separator : '') + source.content.toString();

				return str;
			})
			.join('');

		return this.intro + body;
	}

	isEmpty () {
		if (this.intro.length && this.intro.trim())
			return false;
		if (this.sources.some(source => !source.content.isEmpty()))
			return false;
		return true;
	}

	length() {
		return this.sources.reduce((length, source) => length + source.content.length(), this.intro.length);
	}

	trimLines() {
		return this.trim('[\\r\\n]');
	}

	trim(charType) {
		return this.trimStart(charType).trimEnd(charType);
	}

	trimStart(charType) {
		const rx = new RegExp('^' + (charType || '\\s') + '+');
		this.intro = this.intro.replace(rx, '');

		if (!this.intro) {
			let source;
			let i = 0;

			do {
				source = this.sources[i++];
				if (!source) {
					break;
				}
			} while (!source.content.trimStartAborted(charType));
		}

		return this;
	}

	trimEnd(charType) {
		const rx = new RegExp((charType || '\\s') + '+$');

		let source;
		let i = this.sources.length - 1;

		do {
			source = this.sources[i--];
			if (!source) {
				this.intro = this.intro.replace(rx, '');
				break;
			}
		} while (!source.content.trimEndAborted(charType));

		return this;
	}
}


 // work around TypeScript bug https://github.com/Rich-Harris/magic-string/pull/121

MagicString.Bundle = Bundle;
MagicString.default = MagicString;

export { MagicString as default, MagicString, Bundle, SourceMap, };

