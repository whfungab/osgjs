'use strict';
var MACROUTILS = require( 'osg/Utils' );
var Notify = require( 'osg/Notify' );
var Program = require( 'osg/Program' );
var Shader = require( 'osg/Shader' );
var Map = require( 'osg/Map' );
var Compiler = require( 'osgShader/Compiler' );
var ShaderProcessor = require( 'osgShader/ShaderProcessor' );

// this is the list of attributes type we support by default to generate shader
// if you need to adjust for your need provide or modify this list
// if you still need more fine tuning to the filter, override the filterAttributeTypes
var ShaderGenerator = function () {
    this._cache = {};

    // ShaderProcessor singleton used by ShaderGenerator
    // but user can replace it if needed
    this._shaderProcessor = new ShaderProcessor();

    // ShaderCompiler Object to instanciate
    this._ShaderCompiler = undefined;

    this.setShaderCompiler( Compiler );
};

ShaderGenerator.prototype = {

    // setShaderCompiler that will be used to createShader
    setShaderCompiler: function ( ShaderCompiler ) {
        this._ShaderCompiler = ShaderCompiler;
        if ( !ShaderCompiler.validAttributeTypeCache ) this._computeStateAttributeCache( ShaderCompiler );
    },

    getShaderCompiler: function () {
        return this._ShaderCompiler;
    },


    // return a Set of accepted attribtues to generate shader
    getAcceptAttributeTypes: function () {
        return this._acceptAttributeTypes;
    },


    getShaderProcessor: function () {
        return this._shaderProcessor;
    },

    setShaderProcessor: function ( shaderProcessor ) {
        this._shaderProcessor = shaderProcessor;
    },

    // filter input types and write the result in the outputs array
    filterAttributeTypes: function ( attribute ) {

        // TODO: use same mechanism as acceptAttributesTypes ?
        // with a default set in a var and use overwrittable Set
        // when inheriting the class
        // Faster && Flexiblier
        var libName = attribute.libraryName();
        if ( libName !== 'osg' && libName !== 'osgShadow' && libName !== 'osgAnimation' )
            return true;

        // works for attribute that contains isEnabled
        // Light, Shadow. It let us to filter them to build a shader if not enabled
        if ( attribute.isEnabled && !attribute.isEnabled() ) return true;

        return false;
    },

    // get actives attribute that comes from state
    getActiveAttributeList: function ( state, list ) {

        var hash = '';
        var _attributeArray = state._attributeArray;

        for ( var j = 0, k = _attributeArray.length; j < k; j++ ) {

            var attributeStack = _attributeArray[ j ];
            if ( !attributeStack ) continue;
            var attr = attributeStack.lastApplied;

            if ( !attr || this.filterAttributeTypes( attr ) )
                continue;

            hash = hash + attr.getHash();
            list.push( attr );
        }
        return hash;
    },


    // get actives attribute that comes from state
    getActiveAttributeListCache: function ( state ) {

        var hash = '';
        var _attributeArray = state.lastAppliedAttribute;

        for ( var j = 0, k = state.lastAppliedAttributeLength; j < k; j++ ) {
            var attribute = _attributeArray[ j ];
            hash = hash + attribute.getHash();
        }
        return hash;
    },


    // get actives texture attribute that comes from state
    getActiveTextureAttributeListCache: function ( state ) {

        var hash = '';

        var textureAttributeList = state.lastAppliedTextureAttribute;
        for ( var i = 0, l = state.lastAppliedTextureAttributeLength; i < l; i++ ) {
            var attribute = textureAttributeList[ i ];
            hash = hash + attribute.getHash();
        }
        return hash;
    },


    // get actives texture attribute that comes from state
    getActiveTextureAttributeList: function ( state, list ) {
        var hash = '';
        var _attributeArrayList = state.textureAttributeArrayList;
        var i, l;

        for ( i = 0, l = _attributeArrayList.length; i < l; i++ ) {
            var _attributeArrayForUnit = _attributeArrayList[ i ];

            if ( !_attributeArrayForUnit ) continue;

            list[ i ] = [];

            for ( var j = 0, m = _attributeArrayForUnit.length; j < m; j++ ) {

                var attributeStack = _attributeArrayForUnit[ j ];
                if ( !attributeStack ) continue;
                if ( attributeStack.values().length === 0 ) continue;

                var attr = attributeStack.lastApplied;
                if ( !attr || this.filterAttributeTypes( attr ) )
                    continue;

                if ( attr.isTextureNull() )
                    continue;

                hash = hash + attr.getHash();
                list[ i ].push( attr );
            }
        }
        return hash;
    },

    getActiveUniforms: function ( state, attributeList, textureAttributeList ) {

        var uniforms = {};

        for ( var i = 0, l = attributeList.length; i < l; i++ ) {

            var at = attributeList[ i ];
            if ( at.getOrCreateUniforms ) {
                var attributeUniformMap = at.getOrCreateUniforms();
                // It could happen that uniforms are declared conditionally
                if ( attributeUniformMap !== undefined ) {
                    var attributeUniformMapKeys = attributeUniformMap.getKeys();

                    for ( var j = 0, m = attributeUniformMapKeys.length; j < m; j++ ) {
                        var name = attributeUniformMapKeys[ j ];
                        var uniform = attributeUniformMap[ name ];
                        uniforms[ uniform.getName() ] = uniform;
                    }
                }
            }
        }

        for ( var a = 0, n = textureAttributeList.length; a < n; a++ ) {
            var tat = textureAttributeList[ a ];
            if ( tat ) {
                for ( var b = 0, o = tat.length; b < o; b++ ) {
                    var attr = tat[ b ];

                    var texUniformMap = attr.getOrCreateUniforms( a );
                    var texUniformMapKeys = texUniformMap.getKeys();

                    for ( var t = 0, tl = texUniformMapKeys.length; t < tl; t++ ) {
                        var tname = texUniformMapKeys[ t ];
                        var tuniform = texUniformMap[ tname ];
                        uniforms[ tuniform.getName() ] = tuniform;
                    }
                }
            }
        }

        return new Map( uniforms );
    },

    _computeStateAttributeCache: function ( CompilerShader ) {

        var typeNameTypeId = MACROUTILS.getStateAttributeTypeNameToTypeId();
        var maxId = MACROUTILS.getMaxStateAttributeTypeID();
        var cache = new Uint8Array( maxId + 1 );
        var k;
        var list = CompilerShader.validAttributeType;
        for ( var i = 0, il = list.length; i < il; i++ ) {
            k = typeNameTypeId[ list[ i ] ];
            cache[ k ] = 1;
        }
        CompilerShader.validAttributeTypeCache = cache;
    },

    getOrCreateProgram: ( function () {
        // TODO: double check GC impact of this stack
        // TODO: find a way to get a hash dirty/cache on stateAttribute
        var textureAttributes = [];
        var attributes = [];

        return function ( state ) {
            // extract valid attributes

            // use ShaderCompiler, it can be overrided by a custom one
            var ShaderCompiler = this._ShaderCompiler;

            var hash = '';
            if ( state.lastAppliedAttributeLength )
                hash = hash + this.getActiveAttributeListCache( state );
            if ( state.lastAppliedTextureAttributeLength )
                hash = hash + this.getActiveTextureAttributeListCache( state );

            var cache = this._cache[ hash ];
            if ( cache !== undefined ) return cache;

            // slow path to generate shader
            attributes.length = 0;
            textureAttributes.length = 0;

            this.getActiveAttributeList( state, attributes );
            this.getActiveTextureAttributeList( state, textureAttributes );

            var shaderGen = new ShaderCompiler( attributes, textureAttributes, this._shaderProcessor );

            /* develblock:start */
            // Logs hash, attributes and compiler
            Notify.debug( 'New Compilation ', false, true );
            Notify.debug( {
                Attributes: attributes,
                Texture: textureAttributes,
                Hash: hash,
                Compiler: shaderGen.getFragmentShaderName()
            }, false, true );
            /* develblock:end */

            var vertexshader = shaderGen.createVertexShader();
            var fragmentshader = shaderGen.createFragmentShader();

            var program = new Program(
                new Shader( Shader.VERTEX_SHADER, vertexshader ),
                new Shader( Shader.FRAGMENT_SHADER, fragmentshader ) );

            program.hash = hash;
            program.setActiveUniforms( this.getActiveUniforms( state, attributes, textureAttributes ) );
            program.generated = true;

            this._cache[ hash ] = program;
            return program;
        };
    } )()
};

module.exports = ShaderGenerator;
