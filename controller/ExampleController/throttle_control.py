#!/usr/bin/env python3
"""
Minimal Throttle Control
Drives an ESC on a single GPIO using pigpio. Only forward/backward.
"""

import logging
import sys

# Try to import pigpio for hardware control
try:
    import pigpio
    HARDWARE_AVAILABLE = True
except ImportError:
    HARDWARE_AVAILABLE = False
    print("Warning: pigpio not available. Install with: sudo apt-get install -y pigpio && sudo systemctl enable --now pigpiod", file=sys.stderr)
    print("Running in simulation mode only.", file=sys.stderr)

logger = logging.getLogger(__name__)

class ThrottleController:
    """Controls the vehicle's ESC (motor) for throttle control.

    API:
      - set_throttle(v): v in [-1.0, 1.0]
      - apply_throttle(): writes to GPIO
      - stop_vehicle(): neutral pulse
      - cleanup(): release resources
    """

    # GPIO pin (BCM numbering)
    ESC_GPIO = 18  # physical pin 12

    # ESC pulse width ranges (microseconds)
    MIN_US = 1000      # Full reverse
    NEUTRAL = 1500     # Stop
    MAX_US = 2000      # Full forward
    DB_LOW = 1485      # Deadband below neutral
    DB_HIGH = 1515     # Deadband above neutral

    # PWM frequencies
    ESC_FREQ_HZ = 50   # ESC expects ~50 Hz

    def __init__(self):
        self.pi = None
        self.current_throttle = 0.0  # -1.0 to 1.0
        if HARDWARE_AVAILABLE:
            self.initialize_hardware()
    
    def initialize_hardware(self):
        """Initialize pigpio and ESC hardware"""
        try:
            self.pi = pigpio.pi()
            if not self.pi.connected:
                logger.error("Can't connect to pigpiod. Start it: sudo systemctl start pigpiod")
                HARDWARE_AVAILABLE = False
                return
            
            # Set GPIO modes
            self.pi.set_mode(self.ESC_GPIO, pigpio.OUTPUT)
            
            # Set PWM frequencies
            self.pi.set_PWM_frequency(self.ESC_GPIO, self.ESC_FREQ_HZ)
            
            # Initialize to neutral
            self.pi.set_servo_pulsewidth(self.ESC_GPIO, self.NEUTRAL)
            
            logger.info("ESC hardware initialized successfully")
            
        except Exception as e:
            logger.error(f"ESC hardware initialization failed: {e}")
            HARDWARE_AVAILABLE = False
    
    def map_throttle_to_pulse(self, throttle_value: float) -> int:
        """Map throttle value (-1.0 to 1.0) to ESC pulse width.
        Deadzone near 0 maps to NEUTRAL.
        Negative values map to forward towards MAX_US; positive to reverse towards MIN_US.
        """
        v = float(throttle_value)
        if abs(v) < 0.05:
            return self.NEUTRAL
        if v < 0:  # forward
            lo = self.DB_HIGH + 5
            hi = self.MAX_US
            pct = min(1.0, abs(v))
            return int(lo + (hi - lo) * pct)
        else:     # reverse
            hi = self.DB_LOW - 5
            lo = self.MIN_US
            pct = min(1.0, v)
            return int(hi - (hi - lo) * pct)
    
    def set_throttle(self, throttle_value: float):
        """Set throttle target value in [-1, 1]."""
        self.current_throttle = max(-1.0, min(1.0, float(throttle_value)))
    
    def apply_throttle(self):
        """Apply current throttle value to hardware"""
        if not HARDWARE_AVAILABLE:
            # Simulation mode: nothing to write
            _ = self.map_throttle_to_pulse(self.current_throttle)
            return
        
        try:
            # Apply throttle
            throttle_pulse = self.map_throttle_to_pulse(self.current_throttle)
            self.pi.set_servo_pulsewidth(self.ESC_GPIO, throttle_pulse)
                
        except Exception as e:
            logger.error(f"ESC control error: {e}")
    
    def stop_vehicle(self):
        """Emergency stop - set throttle to neutral"""
        self.current_throttle = 0.0
        
        if HARDWARE_AVAILABLE and self.pi:
            try:
                self.pi.set_servo_pulsewidth(self.ESC_GPIO, self.NEUTRAL)
                logger.info("Vehicle stopped - ESC set to neutral")
            except Exception as e:
                logger.error(f"Error stopping vehicle: {e}")
    
    def cleanup(self):
        """Clean up hardware resources"""
        if HARDWARE_AVAILABLE and self.pi:
            try:
                self.stop_vehicle()
                self.pi.stop()
                logger.info("ESC hardware resources cleaned up")
            except Exception as e:
                logger.error(f"Error during ESC cleanup: {e}")
    
    def get_status(self):
        return {
            'throttle': self.current_throttle,
            'hardware_available': HARDWARE_AVAILABLE,
        }
