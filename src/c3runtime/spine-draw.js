class SpineBatch {
    constructor() {
        // Skeleton instances to render
        this._initialized = false
        this._skeletonInstances = {}
        // SpineDraw rendered yet this frame
        this._rendered = false
        this._tickCount = -1
        this._renderRate = 1;
    }

    get rendered()
    {
        return this._rendered
    }

    get initialized()
    {
        return this._initialized
    }

    get tickCount()
    {
        return this._tickCount
    }

    set tickCount(tick)
    {
        this._tickCount = tick
    }

    get renderRate()
    {
        return this._renderRate;
    }

    set renderRate(renderRate)
    {
        this._renderRate = renderRate;
    }

    init(canvas, runtime)
    {        
        if (this._initialized) return 
        this.runtime = runtime;
        this.canvas = canvas;

        // Get C3 canvas gl context
        // Context already exists and we want to use (for render to texture)
        let config = {}
        this.gl = this.canvas.getContext("webgl2", config) || this.canvas.getContext("webgl", config) || canvas.getContext("experimental-webgl", config);
        let gl = this.gl

        if (!gl) {
            alert('WebGL is unavailable.');
            return;
        }

        let version = 0;
        this.isWebGL2 = false;
        let glVersion = gl.getParameter( gl.VERSION );
    
        if ( glVersion.indexOf( 'WebGL' ) !== - 1 )
        {
           version = parseFloat( /^WebGL\ ([0-9])/.exec( glVersion )[ 1 ] );
           this.isWebGL2 = ( version >= 2.0 );
        } else if ( glVersion.indexOf( 'OpenGL ES' ) !== - 1 )
        {
    
           version = parseFloat( /^OpenGL\ ES\ ([0-9])/.exec( glVersion )[ 1 ] );
           this.isWebGL2 = ( version >= 3.0 );
        }

        if (this.isWebGL2)
        {
            this.myVAO = gl.createVertexArray();
        } else
        {
            let extOESVAO = gl.getExtension("OES_vertex_array_object");
            if (!extOESVAO)
            {
                alert("Spine plugin error: webGL1 with no OES_vertex_array_object support");  // tell user they don't have the required extension or work around it
                return;
            }
            this.myVAO = extOESVAO.createVertexArrayOES();
        }

        this.mvp = new spine.webgl.Matrix4();
        this.shader = spine.webgl.Shader.newTwoColoredTextured(gl);
        this.batcher = new spine.webgl.PolygonBatcher(gl);
        this.renderer = new spine.webgl.SkeletonRenderer(gl);
        this.shapes = new spine.webgl.ShapeRenderer(gl);

        this._initialized = true;
    }

    addInstance(instance, skeletonScale, uid)
    {
        this._skeletonInstances[uid] = {}
        this._skeletonInstances[uid].skeletonInfo = instance
        this._skeletonInstances[uid].initialized = false
        this._skeletonInstances[uid].skeletonScale = skeletonScale
        this._skeletonInstances[uid].onScreen = true
        this._skeletonInstances[uid].tracksComplete = false
        this._skeletonInstances[uid].renderOnce = true
    }

    removeInstance(uid)
    {
        if (!this._skeletonInstances[uid]) return
        delete this._skeletonInstances[uid]
    }

    setInstanceInitialized(uid)
    {
        if (!this._skeletonInstances[uid]) return
        this._skeletonInstances[uid].initialized = true
    }

    setInstanceFB(spineFB, uid)
    {
        if (!this._skeletonInstances[uid]) return
        this._skeletonInstances[uid].spineFB = spineFB
    }

    setInstanceOnScreen(onScreen, uid)
    {
        if (!this._skeletonInstances[uid]) return
        this._skeletonInstances[uid].onScreen = onScreen;
    }

    setInstanceTracksComplete(tracksComplete, uid)
    {
        if (!this._skeletonInstances[uid]) return
        // If transitioning to tracksComplete, render one more time
        if (!this._skeletonInstances[uid].tracksComplete && tracksComplete)
        {
            this._skeletonInstances[uid].renderOnce = true
        }
        this._skeletonInstances[uid].tracksComplete = tracksComplete;
    }

    setInstanceRenderOnce(renderOnce, uid)
    {
        if (!this._skeletonInstances[uid]) return

        this._skeletonInstances[uid].renderOnce = renderOnce;
    }

    resize(bounds, skeletonScale) {
        // magic
        var centerX = bounds.offset.x + (bounds.size.x) / 2;
        var centerY = bounds.offset.y + (bounds.size.y) / 2;
        var scaleX = bounds.size.x / (bounds.size.x);
        var scaleY = bounds.size.y / (bounds.size.y);
        var scale = Math.max(scaleX, scaleY) * (1/skeletonScale);
        if (scale < 1) scale = 1;
        var width = (bounds.size.x) * scale;
        var height = (bounds.size.y) * scale;

        this.mvp.ortho2d(centerX - width / 2, centerY - height / 2, width, height);
    }

    drawBatch() {
        const gl = this.gl;
        const skeletonInstances = this._skeletonInstances;

        // End C3 Batch
        // this.c3wgl.EndBatch();

        var oldFrameBuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);

        // Save C3 webgl context, may be able to reduce some
        // Save VAO to restore

        if (!this.isWebGL2)
        {
            var extOESVAO = gl.getExtension("OES_vertex_array_object");
        }

        if (this.isWebGL2)
        {
            var oldVAO = gl.createVertexArray();
            oldVAO = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
        } else
        {
            var oldVAO = extOESVAO.createVertexArrayOES(); 
            oldVAO = gl.getParameter(extOESVAO.VERTEX_ARRAY_BINDING_OES);
        }

        // Save C3 wegl parameters to restore
        var oldProgram = gl.getParameter(gl.CURRENT_PROGRAM);        
        var oldActive = gl.getParameter(gl.ACTIVE_TEXTURE);            
        var oldTex = gl.getParameter(gl.TEXTURE_BINDING_2D);        
        var oldBinding = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
        var oldElement = gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING);
        var oldClearColor = gl.getParameter(gl.COLOR_CLEAR_VALUE);
        var oldViewport = gl.getParameter(gl.VIEWPORT);
        // Bind to private VAO so Spine use does not impact C3 VAO
        if (this.isWebGL2)
        {
            gl.bindVertexArray(this.myVAO);
        } else
        {
            extOESVAO.bindVertexArrayOES(this.myVAO); 
        }

        let tickCount = this.runtime.GetTickCount();

        // Per instance render
        let index = 0;
        let count = 0;
        for (const uid in skeletonInstances)
        {
            const skeletonInstance = skeletonInstances[uid];
            if (skeletonInstance.initialized && skeletonInstance.onScreen
                && (!skeletonInstance.tracksComplete || skeletonInstance.renderOnce)
                && (tickCount%this._renderRate == index%this._renderRate))
            {
                // console.log('[Spine] render, uid', skeletonInstance.renderOnce, uid)
                // For one off render (e.g. end of track or set slot), now set based on animateOnce
                // skeletonInstance.renderOnce = false;


                count++;
                const bounds = skeletonInstance.skeletonInfo.bounds;
                const premultipliedAlpha = skeletonInstance.skeletonInfo.premultipliedAlpha;

                // Render to our targetTexture by binding the framebuffer to the SpineFB texture
                gl.bindFramebuffer(gl.FRAMEBUFFER, skeletonInstance.spineFB);

                // Set viewport
                gl.viewport(0, 0, bounds.size.x, bounds.size.y);

                // Set proper webgl blend for Spine render
                gl.enable(gl.BLEND);
                gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

                gl.bindTexture(gl.TEXTURE_2D, null);        
                gl.bindBuffer(gl.ARRAY_BUFFER, null);
                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

                // Bind the shader and set the texture and model-view-projection matrix.
                this.shader.bind();
                this.shader.setUniformi(spine.webgl.Shader.SAMPLER, 0);
                // Resize 
                this.resize(bounds, skeletonInstance.skeletonScale);
                this.shader.setUniform4x4f(spine.webgl.Shader.MVP_MATRIX, this.mvp.values);
                
                // Start the batch and tell the SkeletonRenderer to render the active skeleton.
                this.batcher.begin(this.shader);
                
                // Apply vertex effect
                this.renderer.vertexEffect = null;

                gl.clearColor(0, 0, 0, 0);
                gl.clear(gl.COLOR_BUFFER_BIT);

                // Render
                this.renderer.premultipliedAlpha = premultipliedAlpha;
                this.renderer.draw(this.batcher, skeletonInstance.skeletonInfo.skeleton);
                this.batcher.end();
                this.shader.unbind();
            }
            index++;
        }

        this._rendered = true;

        // Change back to C3 FB last used
        gl.bindFramebuffer(gl.FRAMEBUFFER, oldFrameBuffer);

        // Restore C3 webgl state
        gl.useProgram(oldProgram);
        if (this.isWebGL2)
        {
            gl.bindVertexArray(oldVAO);
        } else
        {
            extOESVAO.bindVertexArrayOES(oldVAO); 
        }                    
        gl.activeTexture(oldActive);                
        gl.bindTexture(gl.TEXTURE_2D, oldTex);        
        gl.bindBuffer(gl.ARRAY_BUFFER, oldBinding);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, oldElement);
        gl.clearColor(oldClearColor[0],oldClearColor[1],oldClearColor[2],oldClearColor[3])
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.viewport(oldViewport[0],oldViewport[1],oldViewport[2],oldViewport[3]);
    }

    getRValue(rgb)
    {
        const ALPHAEX_SHIFT = 1024;
        const ALPHAEX_MAX = 1023;
        const RGBEX_SHIFT = 16384;
        const RGBEX_MAX = 8191;
        const RGBEX_MIN = -8192;
        if (rgb >= 0) return (rgb & 255) / 255;
        else {
            let v = Math.floor(-rgb / (RGBEX_SHIFT * RGBEX_SHIFT * ALPHAEX_SHIFT));
            if (v > RGBEX_MAX) v -= RGBEX_SHIFT;
            return v / 1024;
        }
    };

    getGValue(rgb)
    {
        const ALPHAEX_SHIFT = 1024;
        const ALPHAEX_MAX = 1023;
        const RGBEX_SHIFT = 16384;
        const RGBEX_MAX = 8191;
        const RGBEX_MIN = -8192;
        if (rgb >= 0) return ((rgb & 65280) >> 8) / 255;
        else {
        let v = Math.floor(
            (-rgb % (RGBEX_SHIFT * RGBEX_SHIFT * ALPHAEX_SHIFT)) /
            (RGBEX_SHIFT * ALPHAEX_SHIFT)
        );
        if (v > RGBEX_MAX) v -= RGBEX_SHIFT;
        return v / 1024;
        }
    };

    getBValue(rgb)
    {
        const ALPHAEX_SHIFT = 1024;
        const ALPHAEX_MAX = 1023;
        const RGBEX_SHIFT = 16384;
        const RGBEX_MAX = 8191;
        const RGBEX_MIN = -8192;
        if (rgb >= 0) return ((rgb & 16711680) >> 16) / 255;
        else {
        let v = Math.floor(
            (-rgb % (RGBEX_SHIFT * ALPHAEX_SHIFT)) / ALPHAEX_SHIFT
        );
        if (v > RGBEX_MAX) v -= RGBEX_SHIFT;
        return v / 1024;
        }
    };

    getAValue(rgb)
    {
        const ALPHAEX_SHIFT = 1024;
        const ALPHAEX_MAX = 1023;
        const RGBEX_SHIFT = 16384;
        const RGBEX_MAX = 8191;
        const RGBEX_MIN = -8192;
        if (rgb === 0 && 1 / rgb < 0) return 0;
        else if (rgb >= 0) return 1;
        else {
            const v = Math.floor(-rgb % ALPHAEX_SHIFT);
            return v / ALPHAEX_MAX;
        }
    };

  }

if (!globalThis.spineBatcher)
{
    console.log('[Spine] SpineBatcher init');
    globalThis.spineBatcher = new SpineBatch();
}