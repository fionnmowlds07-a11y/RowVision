// The water behind the short pages: the same slow bands of light and chart lines as the home page film, held at its opening colours.
// Drawn small and stretched, and drawn once when reduced motion is asked for. Without WebGL the plain ground shows.
const c = document.getElementById('water'), gl = c && c.getContext('webgl', { antialias: false, alpha: false });
if (gl) {
  gl.getExtension('OES_standard_derivatives');
  const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o; }, pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }'));
  gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, `#extension GL_OES_standard_derivatives : enable
    precision highp float; uniform vec2 r; uniform float t;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
    float fbm(vec2 p){ float s = 0., w = .5; for (int i = 0; i < 4; i++) { s += w * n(p); p = p * 2.03 + 7.1; w *= .5; } return s; }
    void main(){ vec2 uv = gl_FragCoord.xy / r, p = vec2(uv.x * r.x / r.y, uv.y);
      float far = 1. + uv.y * 2.2;
      vec2 q = vec2(p.x * 1.1 + t * .012, p.y * 3.4 * far - t * .03);
      float f = fbm(q + fbm(q * .6 + t * .015) * 1.4);
      vec3 a = vec3(.008, .016, .012), b = vec3(.051, .122, .09);
      vec3 c = mix(a, b, smoothstep(.5, .78, f) * .6 + uv.y * .3);
      float iso = abs(fract(f * 11.) - .5) / (fwidth(f) * 11. + 1e-4);
      c += b * (1. - smoothstep(0., 1.3, iso)) * .2;
      c *= 1. - .6 * pow(length(uv - vec2(.5, .62)) * 1.2, 2.2);
      gl_FragColor = vec4(c, 1.); }`));
  gl.linkProgram(pr);
  if (gl.getProgramParameter(pr, gl.LINK_STATUS)) {
    gl.useProgram(pr);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches, U = n => gl.getUniformLocation(pr, n);
    let last = 0;
    const draw = now => {
      if (!still) requestAnimationFrame(draw);
      if (now - last < 50 && last) return; last = now;     // twenty frames a second is plenty for water this slow
      const w = Math.round(c.clientWidth * .4), hh = Math.round(c.clientHeight * .4); if (c.width != w || c.height != hh) { c.width = w; c.height = hh; gl.viewport(0, 0, w, hh); }
      gl.uniform2f(U('r'), w, hh); gl.uniform1f(U('t'), now / 1000); gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    requestAnimationFrame(draw);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !still) last = 0; });
  } else c.remove();
} else if (c) c.remove();
