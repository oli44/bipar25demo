// https://github.com/nikolaiwarner/aframe-chromakey-material
// think about : https://github.com/b2renger/p5js-shaders/tree/master/AF-shader-vertex-displacement
AFRAME.registerShader('chromakey', {
    schema: {
        src: { type: 'map' },
        color: { default: { x: 0.0, y: 1.0, z: 0.0 }, type: 'vec3', is: 'uniform' },
        chroma: { type: 'bool', is: 'uniform' },
        transparent: { default: true, is: 'uniform' },
        // New properties for displacement
        displacement: { type: 'bool', default: false, is: 'uniform' },
        damplitude: { type: 'float', default: 0.0, is: 'uniform' }
    },

    init: function (data) {

        var videoTexture = new THREE.VideoTexture(data.src)
        videoTexture.minFilter = THREE.LinearFilter
        this.material = new THREE.ShaderMaterial({
            uniforms: {
                chroma: {
                    type: 'b',
                    value: data.chroma
                },
                color: {
                    type: 'c',
                    value: data.color
                },
                myTexture: {
                    type: 't',
                    value: videoTexture
                },
                // New uniforms for displacement
                displacement: {
                    type: 'b',
                    value: data.displacement
                },
                damplitude: {
                    type: 'f',
                    value: data.damplitude
                },
                // A-Frame provides time uniform automatically
            },
            vertexShader:
                `
              #ifdef GL_ES
              precision mediump float;
              #endif
  
              // A-Frame provides these built-in attributes and uniforms automatically
              // attribute vec3 position;
              // attribute vec2 uv;
              // attribute vec3 normal;
              // uniform mat4 modelViewMatrix;
              // uniform mat4 projectionMatrix;
              // uniform float time; // A-Frame time uniform (milliseconds) - Removed as not needed for displacement strength
  
              // Existing uniform for video texture
              uniform sampler2D myTexture;
  
              // New uniforms
              uniform bool displacement;
              uniform float damplitude;
  
              // Varying to pass texture coordinates to the fragment shader
              varying vec2 vUv;
  
              void main(void) {
                vUv = uv; // Pass the original texture coordinates
  
                vec3 displacedPosition = position; // Start with original position
  
                if (displacement) {
                  // Sample the video texture using UV coordinates for displacement
                  // Use a different UV for sampling the video texture if needed, 
                  // but for now, using the geometry's UV for displacement texture lookup
                  vec4 noise = texture2D(myTexture, fract(uv));
  
                  // Calculate a single float noise value from the RGB channels, centered around 0
                  float noiseValue = dot(noise.rgb, vec3(0.333)) - 1.4; // Value between -0.5 and 0.5
  
                  // Apply displacement along the Y axis, scaled by the damplitude uniform
                  displacedPosition.z -= noiseValue * damplitude;
                }
  
                // Calculate final position in clip space using the displaced position
                vec4 mvPosition = modelViewMatrix * vec4(displacedPosition, 1.0);
                gl_Position = projectionMatrix * mvPosition;
              }
            `
            ,
            fragmentShader:
                `
              #ifdef GL_ES
              precision mediump float;
              #endif
  
              uniform sampler2D myTexture; // The video texture
              uniform vec3 color;         // Chromakey color
              uniform bool chroma;        // Chromakey enabled flag
  
              varying vec2 vUv;           // Texture coordinates from the vertex shader
  
              void main(void) {
                vec3 tColor = texture2D(myTexture, vUv).rgb; // Sample the video texture
                float a; // Alpha value
  
                if (chroma) {
                  // Chromakey calculation
                  a = (length(tColor - color) - 0.5) * 7.0;
                } else {
                  a = 1.0;
                }
  
                // Clamp alpha between 0.0 and 1.0
                a = clamp(a, 0.0, 1.0);
  
                // Output the color with the calculated alpha
                gl_FragColor = vec4(tColor, a);
              }
              `
        })
    },

    update: function (data) {
        this.material.color = data.color;
        this.material.src = data.src;
        this.material.transparent = data.transparent;
        // Update new uniforms
        this.material.uniforms.displacement.value = data.displacement;
        this.material.uniforms.damplitude.value = data.damplitude;
    },

})


AFRAME.registerComponent('play-sound-and-displace', {
    init: function () {
        this.soundEl = document.querySelector('#audio'); // Get the audio element
        this.material = null; // Will be set when the mesh is available
        this.analyser = null;
        this.dataArray = null;
        this.frameId = null;
        this.audioContext = null; // Store AudioContext

        const self = this; // Keep a reference to the component

        this.el.addEventListener('targetFound', event => {
            console.log("target found");

            // Get the material after the mesh is created
            if (!this.material) {
                this.material = this.el.getObject3D('mesh').material;
            }

            var videoEl = this.el.getAttribute('material').src;
            if (!videoEl) { return; }
            this.el.object3D.visible = true;

            // Check if video is already playing before attempting to play
            if (videoEl.paused) {
                videoEl.play();
            }

            // Play the audio, loop, and set up analyser
            if (this.soundEl) {
                // Create and resume AudioContext on user gesture (targetFound)
                if (!this.audioContext) {
                    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                    const source = this.audioContext.createMediaElementSource(this.soundEl);
                    this.analyser = this.audioContext.createAnalyser();
                    source.connect(this.analyser);
                    this.analyser.connect(this.audioContext.destination);
                    this.analyser.fftSize = 256; // or higher for more detail
                    const bufferLength = this.analyser.frequencyBinCount;
                    this.dataArray = new Uint8Array(bufferLength);
                }

                // Resume context if suspended
                if (this.audioContext.state === 'suspended') {
                    this.audioContext.resume();
                }

                this.soundEl.play();
                this.soundEl.loop = true;

                // Start updating displacement based on sound
                this.updateDisplacement();
            }

        });

        this.el.addEventListener('targetLost', event => {
            console.log("target lost");
            var videoEl = this.el.getAttribute('material').src;
            if (!videoEl) { return; }
            this.el.object3D.visible = false;
            // Pause only if video is playing
            if (!videoEl.paused) {
                videoEl.pause();
            }

            // Pause and rewind audio, stop updating displacement
            if (this.soundEl) {
                this.soundEl.pause();
                this.soundEl.currentTime = 0;
                this.soundEl.loop = false;
                if (this.frameId) {
                    cancelAnimationFrame(this.frameId);
                    this.frameId = null;
                }
                // Reset displacement amplitude
                if (this.material && this.material.uniforms.damplitude) {
                    this.material.uniforms.damplitude.value = 0;
                }
            }
        });
    },

    updateDisplacement: function () {
        if (!this.analyser || !this.dataArray || !this.material || !this.material.uniforms.damplitude) {
            this.frameId = requestAnimationFrame(this.updateDisplacement.bind(this));
            return;
        }

        this.analyser.getByteFrequencyData(this.dataArray);

        // Calculate a simple average amplitude
        let sum = 0;
        for (let i = 0; i < this.dataArray.length; i++) {
            sum += this.dataArray[i];
        }
        const average = sum / this.dataArray.length;

        // Map the average amplitude to a displacement value
        // Adjust the multiplier and offset to control the range and intensity of displacement
        // Example mapping: normalize average (0-255) to a range like 0 to 0.5 for damplitude
        const displacementAmount = (average / 255.0) * 0.5; // Scale to a max damplitude of 0.5

        // Update the shader uniform
        this.material.uniforms.damplitude.value = displacementAmount;

        // Request the next frame
        this.frameId = requestAnimationFrame(this.updateDisplacement.bind(this));
    },

    play: function () { },
    pause: function () { },
    remove: function () {
        // Clean up on component removal
        if (this.frameId) {
            cancelAnimationFrame(this.frameId);
            this.frameId = null;
        }
        if (this.soundEl) {
            this.soundEl.pause();
            this.soundEl.currentTime = 0;
            this.soundEl.loop = false;
        }
        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close();
            this.audioContext = null;
        }
        // Reset displacement amplitude if material is still available
        if (this.material && this.material.uniforms.damplitude) {
            this.material.uniforms.damplitude.value = 0;
        }
    }
});
