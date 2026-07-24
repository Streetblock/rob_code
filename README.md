# svg_rob_code
Implementation of Rings of Bytes Code generator in SVG, embedded in an HTML page, with an in page form to modify the RoBCode parameters. 

The RoBCodes are computer generated art. There is no known decoder. There is no key to orient the image for decoding, though it may be possible to deduce the bytes from the parity bits. Our original house design was a RoBCode, but for practical reasons, it got culled back to an octagon (not that an octagon is very practical :) (see: https://www.google.co.nz/maps/@-36.9906225,174.4870949,197m/data=!3m1!1e3). 

Open `index.html` to use the current generator. `svg_arc.html` is kept as the
historical byte-oriented implementation.

## Project structure

- `index.html` contains the page markup.
- `style.css` contains the presentation rules.
- `lib/rob-code.js` contains the object-oriented SVG renderer and encoding logic.
- `app.js` connects the form controls to the renderer.
- `svg_arc.html` and `Old/` retain the historical implementations.

## RoBCode 2

The proposed decodable barcode profile is specified independently in
[`docs/FORMAT.md`](docs/FORMAT.md). Machine-readable golden vectors live in
[`docs/test-vectors.json`](docs/test-vectors.json). The format encoder is
implemented as the independent `RoBCode2Encoder` class in
[`lib/rob-code-v2.js`](lib/rob-code-v2.js). The normative SVG renderer is the
separate `RoBCode2SvgRenderer` class in
[`lib/rob-code-v2-svg.js`](lib/rob-code-v2-svg.js). The studio in `index.html`
uses RoBCode 2 by default, reports the encoded symbol size, and exports the
result as SVG. A mode switch retains access to every Legacy generator option.
The independent `RoBCode2Decoder` in
[`lib/rob-code-v2-decoder.js`](lib/rob-code-v2-decoder.js) validates and
recovers already-oriented data cells, including Reed–Solomon correction. SVG
and camera sampling are intentionally separate layers.
Generated SVG files can be validated and decoded from either source text or an
SVG DOM element with `RoBCode2SvgImporter` in
[`lib/rob-code-v2-svg-importer.js`](lib/rob-code-v2-svg-importer.js).
The RoBCode 2 studio exposes this importer through a local SVG file picker and
shows the verified payload together with correction and parity diagnostics.
Lossless raster exports can be sampled with
`RoBCode2RasterSampler` in
[`lib/rob-code-v2-raster-sampler.js`](lib/rob-code-v2-raster-sampler.js). It
localizes the continuous outer frame and then detects ring scale, rotation, and
mirroring before invoking the cell decoder. Rectangular canvases, offset
symbols, extra margins, and cropping within the quiet zone are supported.
Reliable sampling requires at least eight image pixels per module. The outer
frame must remain complete. Perspective correction is not yet part of this
layer.
The studio can export the current symbol as a lossless PNG at a decodable
resolution and can locally validate and decode lossless PNG files
through the same result panel used for SVG imports.

##History
Reimplements the earlier Python code, that produced a postscript file as output (ca the summer of 2013/14), and based on the target_library.ps and cardTemplate.ps from Diego Lopez de Iping TripCode generator (Diego's code was in turn, based on Jeremy Henty's code). 

The Python code, was in turn, a reimplementation of the C version, ca 1985, which leveraged even earlier code for drawing bytes (8 bit, plus 1 parity bit) on concentric circles, to help students visualise how data is stored on disks (B&W Quickdraw on Lisa and 128M Macs). Many of the disk visualisations where visually attractive, reminiscent of scifi art, and so was born the first RoBCode generator (Yes, a pun. We had lots of Robs in Computer Science at that time). 

#Calculating where the Bytes go
Bytes are drawn in concentric rings,  either increasing each ring linearly, or exponentially. 

###Linear Case
```
  For a step_size of 2, then there are 2 bytes in ring 1, 4 bytes in ring 2, 6 bytes in ring 3, 8 bytes in ring 4, ...
  The number of bytes in any ring r, is r * step_size
  The number of bytes that can be presented in r rings is step_size/2 * (r*r + r)
  To find the ring, from a byte's index i: Math.ceil((-step_size/2 + Math.sqrt(step_size/2*step_size/2 - 4*step_size/2*(-i)))/step_size);
```  
###Exponential case
```
  For a base of 2, then there are 2 bytes in ring 1, 4 bytes in ring 2, 8 bytes in ring 3, 16 in ring 4, ...
  The number of bytes in any ring r, is Math.pow(base, r)
  The number of bytes that can be presented in r rings is ((1-Math.pow(base,r))/(1-base))*base
  To find the ring r, from a byte's index i: Math.floor( Math.log( (1 - (i-1)/base*(1-base) )) / Math.log(base) ) + 1
```
###Sectors, instead of bytes
The current `index.html` version replaces the byte calculations with sector calculations, then allows multiple bytes in one sector. When the
bytes per sector = 1, then the `svg_arc.html` and `index.html` versions give the same result.

##Reducing White Space
XOR and other encodings have been used to improved to visual appearance, by reducing large areas of white space, especially when there are partially filled rings. This further complicates decoding, unless the XOR byte(s), or other encoding is known. 

##Centre
A central circle, a half circle and ring, and a one byte pattern have all been used to enhance the visual appearance. The original also added an encoding marker, to mimic the hole in floppy disk to find the first sector. 

##Frame
Adding a thin ring, just beyond the last byte ring, helps frame the RoBCode.

##Linear version
The Unroll option draws the tracks as stacked rectangles, the inner track an top.


