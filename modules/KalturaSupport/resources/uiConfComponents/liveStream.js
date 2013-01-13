( function( mw, $ ) {/*"use strict";*/
	mw.addKalturaConfCheck( function( embedPlayer, callback ) {
		if ( embedPlayer.isLive() ) {
			var liveStreamPlugin = {

				bindPostFix : '.liveStream',
				
				firstPlay : false,
				/**
				 * API requests interval for updating live stream status (seconds).
				 * Default is 30 seconds, to match server's cache expiration
				 */
				liveStreamStatusInterval : 30,
				
				// Default DVR Window (Seconds)
				defaultDVRWindow : 30 * 60,
				
				// Minimal broadcast time allowed for DVR playback (Seconds)
				minDVRTime : 30,
				
				minDVRReached : false,
				
				vidStartTime : null,
				
				clockStartTime : null,
				
				lastTimeDisplayed : 0,

				init: function( embedPlayer ) {
					this.embedPlayer = embedPlayer;
					
					this.addLiveStreamStatusMonitor();
					this.addLiveStreamStatus();
					if ( this.isDVR() ) {
						this.dvrWindow = embedPlayer.evaluate( '{mediaProxy.entry.dvrWindow}' ) * 60;
						if ( !this.dvrWindow ) {
							this.dvrWindow = this.defaultDVRWindow;
						}
						this.addScrubber();
						this.addTimeDisplay();
						this.addBackToLiveButton();
					}
					this.addPlayerBindings();
					this.extendApi();
				},
				
				isDVR: function(){
					return this.embedPlayer.evaluate( '{mediaProxy.entry.dvrStatus}' );
				},
				
				addPlayerBindings: function() {
					var _this = this;
					var embedPlayer = this.embedPlayer;

					embedPlayer.unbindHelper( _this.bindPostFix );
					
					embedPlayer.bindHelper( 'playerReady' + this.bindPostFix, function() {
						if ( _this.isDVR() ) {
							_this.hideLiveStreamStatus();
							_this.hideScrubber();
							_this.hideBackToLive();
							_this.disableLiveControls();
							embedPlayer.addPlayerSpinner();
							_this.getLiveStreamStatusFromAPI( function( onAirStatus ) {
								_this.showLiveStreamStatus();
								embedPlayer.hideSpinner();
							} );
						}
					} );
					
					embedPlayer.bindHelper( 'onplay' + this.bindPostFix, function() {
						if ( _this.isDVR ) {
							_this.hideLiveStreamStatus();
							_this.removePausedMonitor();
						}
					} );
					
					embedPlayer.bindHelper( 'onpause' + this.bindPostFix, function() {
						if ( _this.isDVR() ) {
							_this.disableLiveControls();
							_this.unsetLiveIndicator();
							embedPlayer.addPlayerSpinner();
							_this.getLiveStreamStatusFromAPI( function( onAirStatus ) {
								_this.showLiveStreamStatus();
								if ( onAirStatus ) {
									_this.showBackToLive();
									_this.addPausedMonitor();
								}
								_this.enableLiveControls();
							} );
						}
					} );
					
					embedPlayer.bindHelper( 'liveStreamStatusUpdate' + this.bindPostFix, function( e, onAirObj ) {
						_this.setLiveStreamStatus( _this.getLiveStreamStatusText() );
						if ( !_this.firstPlay || !_this.isDVR() ) {
							_this.toggleLiveControls( onAirObj.onAirStatus );
						}
						if ( _this.isDVR() && !onAirObj.onAirStatus ) {
							_this.hideBackToLive();
						}
					} );
					
					embedPlayer.bindHelper( 'firstPlay' + this.bindPostFix, function() {
						_this.firstPlay = true;
						if ( _this.isDVR() ) {
							var vid = embedPlayer.getPlayerElement();
							$( vid ).bind( 'playing' + _this.bindPostFix, function() {
								$( vid ).unbind( 'playing' + _this.bindPostFix );
								_this.setLiveIndicator();
								_this.disableScrubber();
								_this.showScrubber();
								_this.vidStartTime = _this.getCurrentTime();
								_this.clockStartTime = new Date().getTime();
								if ( _this.vidStartTime < _this.minDVRTime ) {
									_this.addMinDVRMonitor();
									return ;
								}
								_this.minDVRReached = true;
								_this.enableScrubber();
							} );	
						}
					} );

				},
				
				addMinDVRMonitor: function() {
					var _this = this;
					var currTime = this.getCurrentTime();
					this.minDVRMonitor = setInterval( function() {
						if ( currTime >= _this.minDVRTime ) {
							_this.minDVRReached = true;
							_this.enableScrubber();
							_this.removeMinDVRMonitor();
							return ;
						}
						currTime = _this.getCurrentTime();
					}, 1000 )
				},
				
				removeMinDVRMonitor: function() {
					this.minDVRMonitor = clearInterval( this.minDVRMonitor );
				},
				
				addLiveStreamStatusMonitor: function() {
					var _this = this;
					this.liveStreamStatusMonitor = setInterval( function() {
						_this.getLiveStreamStatusFromAPI();
					}, _this.liveStreamStatusInterval * 1000 );
				},
				
				removeLiveStreamStatusMonitor: function() {
					this.liveStreamStatusMonitor = clearInterval( this.liveStreamStatusMonitor );
				},
				
				addPausedMonitor: function() {
					var _this = this;
					var embedPlayer = this.embedPlayer;
					var vid = embedPlayer.getPlayerElement();
					var pauseTime = vid.currentTime;
					var pauseClockTime = new Date().getTime();
					var totalTime = ( pauseTime < _this.dvrWindow ) ? pauseTime : _this.dvrWindow;
					this.pausedMonitor = setInterval( function() {
						var timePassed = ( new Date().getTime() - pauseClockTime ) / 1000;
						var updateTime = _this.lastTimeDisplayed + timePassed;
						if ( updateTime > totalTime ) {
							updateTime = totalTime;
						}
						var perc = _this.lastTimeDisplayed / totalTime;
						_this.updateScrubber( 1 - perc );
						_this.setTimeDisplay( '-' + mw.seconds2npt( updateTime ) );
					}, mw.getConfig( 'EmbedPlayer.MonitorRate' ) );
				},
				
				removePausedMonitor: function() {
					this.lastTimeDisplayed = mw.npt2seconds( this.getTimeDisplay() );
					this.pausedMonitor = clearInterval( this.pausedMonitor );
				},
				
				/**
				 * Add on/off air status to the control bar
				 */
				addLiveStreamStatus: function() {
					var embedPlayer = this.embedPlayer;
					embedPlayer.bindHelper( 'addControlBarComponent', function(event, controlBar ) {
						var $liveStreamStatus = {
							'w': 28,
							'o': function( ctrlObj ) {
								return $( '<div />' ).addClass( "ui-widget live-stream-status" );
							}
						};
						
						// Add the button to control bar
						controlBar.supportedComponents[ 'liveStreamStatus' ] = true;
						controlBar.components[ 'liveStreamStatus' ] = $liveStreamStatus;
					} );
				},
				
				/**
				 * Add DVR Scrubber, to enable seeking within the DVR window
				 */
				addScrubber: function() {
					var _this = this;
					var embedPlayer = this.embedPlayer;
					
					embedPlayer.bindHelper( 'addControlBarComponent', function(event, controlBar ) {
						var $liveStreamDVRScrubber = {
							'w':0, // special case (takes up remaining space)
							'o': function( ctrlObj ) {
								
								var sliderConfig = {
									range: "max",
									// Start at the end
									value: 1000,
									min: 0,
									max: 1000,
									// we want less than monitor rate for smoth animation
									animate: mw.getConfig( 'EmbedPlayer.MonitorRate' ) - ( mw.getConfig( 'EmbedPlayer.MonitorRate' ) / 30 ),
									start: function( event, ui ) {
										_this.userSlide = true;
										embedPlayer.getInterface().find( '.play-btn-large' ).fadeOut( 'fast' );
									},
									slide: function( event, ui ) {
										var perc = ui.value / 1000;
										
										var totalTime = ( _this.getCurrentTime() < _this.dvrWindow ) ? _this.getCurrentTime() : _this.dvrWindow;
										// always update the title 
										if ( perc > .99 ) { 
											// Sliding to the rightmost side: Go back to live broadcast with matching indication
											embedPlayer.getInterface().find( '.play_head_dvr .ui-slider-handle' ).attr( 'data-title', 'Live' );
											_this.setLiveIndicator();
											return ;
										}
										// Slider percentage is calculated based on a left-to-right slider. We need the opposite
										var jumpToTime = ( 1 - perc ) * totalTime;
										embedPlayer.getInterface().find( '.play_head_dvr .ui-slider-handle' ).attr( 'data-title', mw.seconds2npt( jumpToTime ) );
										// Show negative time indication (How much time we seek backwards from current, "live", position
										_this.setTimeDisplay( '-' + mw.seconds2npt( jumpToTime ) )
									},
									change: function( event, ui ) {
										var perc = ui.value / 1000;
										
										var totalTime = ( _this.getCurrentTime() < _this.dvrWindow ) ? _this.getCurrentTime() : _this.dvrWindow;
										var jumpToTime = ( 1 - perc ) * totalTime;
										// always update the title 
										if ( perc > .99 ) {
											ui.value = 1000;
											embedPlayer.getInterface().find( '.play_head_dvr .ui-slider-handle' ).attr( 'data-title', 'Live' );
											_this.setLiveIndicator();
										}
										else {
											embedPlayer.getInterface().find( '.play_head_dvr .ui-slider-handle' ).attr( 'data-title', mw.seconds2npt( jumpToTime ) );
											_this.showBackToLive();
										}
										// Only run the onChange event if done by a user slide
										// (otherwise it runs times it should not)
										if ( _this.userSlide ) {
											_this.userSlide = false;
											if ( perc > .98 ) {
												_this.backToLive();
												return ;
											}
											_this.setCurrentTime( jumpToTime );
											_this.lastTimeDisplayed = jumpToTime;
										}
									}
								};
								
								// Right offset for the scrubber = 
								// ( Total width - non used space - Pause button width ) + ( Time display width + Live Stream Status Width )
								var rightOffset = ( embedPlayer.getPlayerWidth() - ctrlObj.availableWidth - ctrlObj.components.pause.w )
								var $playHead = $( '<div />' )
									.addClass ( "play_head_dvr" )
									.css( {
										"position" : 'absolute',
										"left" : ( ctrlObj.components.pause.w + 4 ) + 'px',
										"right" : rightOffset + 'px'
									} )
									// Playhead binding
									.slider( sliderConfig );

								// Up the z-index of the default status indicator:
								$playHead.find( '.ui-slider-handle' )
									.attr('data-title', mw.seconds2npt( 0 ) );
								$playHead.find( '.ui-slider-range' ).addClass( 'ui-corner-all' ).css( 'z-index', 2 );

								return $playHead;
							}
						}

						// Add the scrubber to control bar
						controlBar.supportedComponents[ 'liveStreamDVRScrubber' ] = true;
						controlBar.components[ 'liveStreamDVRScrubber' ] = $liveStreamDVRScrubber;
					} );
				},
				
				/**
				 * Show time display / Live indicator
				 */
				addTimeDisplay: function() {
					var _this = this;
					var embedPlayer = this.embedPlayer;
					
					embedPlayer.bindHelper( 'addControlBarComponent', function(event, controlBar ) {
						var $liveStreamTimeDisplay = {
							'w' : mw.getConfig( 'EmbedPlayer.TimeDisplayWidth' ),
							'o' : function( ctrlObj ) {
								return $( '<div />' ).addClass( "ui-widget time-disp-dvr" );
							}
						}

						// Add the scrubber to control bar
						controlBar.supportedComponents[ 'liveStreamDVRStatus' ] = true;
						controlBar.components[ 'liveStreamDVRStatus' ] = $liveStreamTimeDisplay;
					} );
				},
				
				addBackToLiveButton: function() {
					var _this = this;
					var embedPlayer = this.embedPlayer;
					
					embedPlayer.bindHelper( 'addControlBarComponent', function(event, controlBar ) {
						var $backToLiveWrapper = 
							$( '<div />' )
								.addClass( 'back-to-live-icon' )
								.after( 
									$( '<div />')
										.addClass( 'back-to-live-text' )
										.text( 'Live' ) 
								);
						var $backToLiveButton = 
							$( '<div />')
								.addClass( 'ui-widget back-to-live' )
								.html( $backToLiveWrapper )
								.click( function() {
									_this.backToLive();
								} );
						var $backToLive = {
							'w' : 28,
							'o' : function( ctrlObj ) {
								return $backToLiveButton;
							}
						}

						// Add the scrubber to control bar
						controlBar.supportedComponents[ 'backToLive' ] = true;
						controlBar.components[ 'backToLive' ] = $backToLive;
					} );
				},
				
				/**
				 * Set live indication
				 */
				setLiveIndicator: function() {
					if( this.embedPlayer.getInterface() && !embedPlayer.isOffline() ) {
						this.embedPlayer.getInterface().find( '.time-disp-dvr' ).addClass( 'time-disp-dvr-live' ).html( 'Live' );
					}
				},
				
				/**
				 * Unset live indication
				 */
				unsetLiveIndicator: function() {
					if( this.embedPlayer.getInterface() && this.embedPlayer.getInterface().find( '.time-disp-dvr' ).hasClass( 'time-disp-dvr-live' ) ) {
						this.embedPlayer.getInterface().find( '.time-disp-dvr' ).removeClass( 'time-disp-dvr-live' ).html( '' );
					}					
				},
				
				setTimeDisplay: function( value ) {
					this.unsetLiveIndicator();
					if( this.embedPlayer.getInterface() ) {
						this.embedPlayer.getInterface().find( '.time-disp-dvr' ).html( value );
					}
				},
				
				getTimeDisplay: function() {
					if ( this.embedPlayer.getInterface() ) {
						return this.embedPlayer.getInterface().find( '.time-disp-dvr' ).text().substr( 1 );
					}
					return null;
				},
				
				showBackToLive: function() {
					var embedPlayer = this.embedPlayer;
					
					this.hideLiveStreamStatus();
					if ( embedPlayer.getInterface().find( '.back-to-live' ).length ) {
						embedPlayer.getInterface().find( '.back-to-live' ).show();
					}
				},
				
				hideBackToLive: function() {
					var embedPlayer = this.embedPlayer;
					
					if ( embedPlayer.getInterface().find( '.back-to-live' ).length ) {
						embedPlayer.getInterface().find( '.back-to-live' ).hide();
					}
				},
				
				backToLive: function() {
					var _this = this;
					var embedPlayer = this.embedPlayer;
					
					this.disableLiveControls();
					embedPlayer.addPlayerSpinner();
					this.hideBackToLive();
					this.updateScrubber( 1 );
					var vid = embedPlayer.getPlayerElement();
					$( vid ).bind( 'playing' + this.bindPostFix, function() {
						$( vid ).unbind( 'playing' + this.bindPostFix );
						embedPlayer.hideSpinner();
						_this.enableLiveControls( true );
						_this.setLiveIndicator();
					} );
					vid.load();
					vid.play();
				},
				
				hideTimeDisplay: function() {
					this.setTimeDisplay( '' );
				},

				/**
				 * Hide on/off air status from the control bar
				 */
				hideLiveStreamStatus: function() {
					this.embedPlayer.getInterface().find( '.live-stream-status' ).hide();
				},
				
				/**
				 * Restore hidden on/off air status
				 */
				showLiveStreamStatus: function() {
					this.embedPlayer.getInterface().find( '.live-stream-status' ).show();
				},
				
				/**
				 * Get on/off air status based on the API and update locally
				 */
				getLiveStreamStatusFromAPI: function( callback ) {
					var _this = this;
					var embedPlayer = this.embedPlayer;
					
					_this.getKalturaClient().doRequest( {
						'service' : 'liveStream',
						'action' : 'islive',
						'id' : embedPlayer.kentryid,
						'protocol' : 'hls',
						'timestamp' : new Date().getTime()
					}, function( data ) {
						_this.onAirStatus = false;
						if ( data === true ) {
							_this.onAirStatus = true;
						}
						if ( callback ) {
							callback( _this.onAirStatus );
						}
						embedPlayer.triggerHelper( 'liveStreamStatusUpdate', { 'onAirStatus' : _this.onAirStatus } );
					} );
				},
				
				getLiveStreamStatusText: function() {
					if ( this.onAirStatus ) {
						return 'On Air';
					}
					return 'Off Air';
				},
				
				setLiveStreamStatus: function( value ) {
					var embedPlayer = this.embedPlayer;
					
					var $liveStatus = embedPlayer.getInterface().find( '.live-stream-status' );
					$liveStatus.html( value );
					if ( this.onAirStatus ) {
						$liveStatus.removeClass( 'live-off-air' ).addClass( 'live-on-air' );
					}
					else {
						$liveStatus.removeClass( 'live-on-air' ).addClass( 'live-off-air' );
					}
				},
								
				/**
				 * Updates the scrubber to the requested percentage
				 */
				updateScrubber: function( perc ) {
					var $playHead = this.embedPlayer.getInterface().find( '.play_head_dvr' );
					
					if ( $playHead.length ) {
						$playHead.slider( 'value', perc * 1000 );
					}
				},
				
				/**
				 * Returns current scrubber position (Value 0-1000)
				 */
				getCurrentScrubberPosition: function() {
					var $playHead = this.embedPlayer.getInterface().find( '.play_head_dvr' );
					
					if ( $playHead.length ) {
						return ( $playHead.slider( "value" ) );
					}
					return null;
				},
				
				
				/**
				 * Disable DVR scrubber
				 */
				disableScrubber: function() {
					var embedPlayer = this.embedPlayer;
					if ( this.isDVR() ) {
						var $playHead = embedPlayer.getInterface().find( ".play_head_dvr" );
						if( $playHead.length ){
							$playHead.slider( "option", "disabled", true );
						}
					}
				},
				
				/**
				 * Enable DVR scrubber
				 */				
				enableScrubber: function() {
					var embedPlayer = this.embedPlayer;
					if ( this.isDVR() ) {
						var $playHead = embedPlayer.getInterface().find( ".play_head_dvr" );
						if( $playHead.length ){
							$playHead.slider( "option", "disabled", false);
						}
					}
				},
				
				/**
				 * Hide DVR scrubber off control bar
				 */
				hideScrubber: function() {
					var embedPlayer = this.embedPlayer;
					if ( this.isDVR() ) {
						var $playHead = embedPlayer.getInterface().find( ".play_head_dvr" );
						if( $playHead.length ){
							$playHead.hide();
						}
					}					
				},

				/**
				 * Show DVR scrubber off control bar
				 */
				showScrubber: function() {
					var embedPlayer = this.embedPlayer;
					if ( this.isDVR() ) {
						var $playHead = embedPlayer.getInterface().find( ".play_head_dvr" );
						if( $playHead.length ){
							$playHead.show();
						}
					}					
				},
				
				/**
				 * While the stream is off air we disable the play controls and the scrubber
				 */
				disableLiveControls: function() {
					// Only disable enabled controls
					if ( typeof this.liveControls == 'undefined' || this.liveControls === true ) {
						var embedPlayer = this.embedPlayer;
						embedPlayer.hideLargePlayBtn();
						embedPlayer.disablePlayControls();
						embedPlayer.controlBuilder.removePlayerTouchBindings();
						embedPlayer.controlBuilder.removePlayerClickBindings();
						embedPlayer.getInterface().find( '.play-btn' )
							.unbind('click')
							.click( function( ) {
								if( embedPlayer._playContorls ){
									embedPlayer.play();
								}
							} );
						this.disableScrubber();
						this.liveControls = false;
					}
				},
				
				enableLiveControls: function( hidePlayBtn ) {
					// Only enable disabled controls
					if ( this.liveControls === false ) {
						var embedPlayer = this.embedPlayer;
						embedPlayer.hideSpinner();
						if ( !hidePlayBtn ) {
							embedPlayer.addLargePlayBtn();
						}
						embedPlayer.enablePlayControls();
						embedPlayer.controlBuilder.addPlayerTouchBindings();
						embedPlayer.controlBuilder.addPlayerClickBindings();
						if ( this.minDVRReached ) {
							this.enableScrubber();
						}
						this.liveControls = true;
					}
				},
				
				toggleLiveControls: function( onAirStatus ) {
					if ( onAirStatus ) {
						this.enableLiveControls();
						return ;
					}
					this.disableLiveControls();
				},
				
				getCurrentTime: function() {
					return this.embedPlayer.getPlayerElement().currentTime;
				},
				
				setCurrentTime: function( sec ) {
					try {
						this.embedPlayer.getPlayerElement().currentTime = sec;
					} catch ( e ) {
						mw.log("Error:: liveStreamPlugin: Could not set video currentTime");
					}
				},				

				/**
				 * Extend JS API to match the KDP
				 */
				extendApi: function() {
					var _this = this;
					var embedPlayer = this.embedPlayer;
					
					embedPlayer.isOffline = function() {
						return !_this.onAirStatus;
					}
				},

				getKalturaClient: function() {
					if( ! this.kClient ) {
						this.kClient = mw.kApiGetPartnerClient( this.embedPlayer.kwidgetid );
					}
					return this.kClient;
				}
			}
			
			liveStreamPlugin.init( embedPlayer );
		}

		callback();
	});

} )( window.mw, window.jQuery );
