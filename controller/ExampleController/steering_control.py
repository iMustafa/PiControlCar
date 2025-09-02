#!/usr/bin/env python3
"""
Minimal Steering Control
Drives a servo via Adafruit ServoKit (PCA9685). Only steering angle.
"""

import logging
import sys

# Try to import Adafruit ServoKit for servo controller
try:
    import board
    from adafruit_servokit import ServoKit
    SERVO_KIT_AVAILABLE = True
except ImportError:
    SERVO_KIT_AVAILABLE = False
    print("Warning: Adafruit ServoKit not available. Install with: pip install adafruit-circuitpython-servokit", file=sys.stderr)
    print("Steering will run in simulation mode.", file=sys.stderr)

logger = logging.getLogger(__name__)

class SteeringController:
    """Controls the vehicle's steering servo via ServoKit."""
    
    # Your servo's calibrated safe range
    SERVO_SAFE_MIN_PERCENT = 10.0  # Minimum safe angle
    SERVO_SAFE_MAX_PERCENT = 90.0  # Maximum safe angle
    SERVO_CENTER_PERCENT = 50.0    # Center position
    
    def __init__(self):
        self.servo_kit = None
        self.current_steering = 0.0      # -1.0 to 1.0
        
        if SERVO_KIT_AVAILABLE:
            self.initialize_servo_kit()
    
    def initialize_servo_kit(self):
        """Initialize Adafruit ServoKit for steering control via I2C"""
        try:
            # Initialize ServoKit with 16 channels, I2C address 0x40, 50Hz frequency
            self.servo_kit = ServoKit(channels=16, i2c=board.I2C(), address=0x40, frequency=50)
            
            # Set pulse width range for the 35kg servo on channel 0
            self.servo_kit.servo[0].set_pulse_width_range(1000, 2000)
            
            logger.info("ServoKit initialized successfully via I2C")
            
        except Exception as e:
            logger.error(f"ServoKit initialization failed: {e}")
            SERVO_KIT_AVAILABLE = False
    
    def map_steering_to_angle(self, steering_value: float) -> int:
        """Map steering value (-1.0 to 1.0) to servo angle."""
        if abs(steering_value) < 0.05:  # Deadzone
            return 90
        
        # Map -1.0 to 1.0 to 0% to 100% (swapped: -1=left, 1=right)
        user_percent = (1.0 - steering_value) * 50.0
        
        # Map 0-100% input to safe servo range
        safe_percent = self.SERVO_SAFE_MIN_PERCENT + (
            (user_percent / 100.0) * (self.SERVO_SAFE_MAX_PERCENT - self.SERVO_SAFE_MIN_PERCENT)
        )
        
        # Convert percentage to angle (0-180 degrees)
        angle = int(safe_percent * 1.8)
        
        # Clamp to valid servo range
        angle = max(0, min(180, angle))
        
        return angle
    
    def set_steering(self, steering_value: float):
        """Set steering target value in [-1, 1]."""
        self.current_steering = max(-1.0, min(1.0, float(steering_value)))
    
    def apply_steering(self):
        """Apply current steering value to hardware"""
        if not SERVO_KIT_AVAILABLE or not self.servo_kit:
            # Simulation mode: nothing to write
            _ = self.map_steering_to_angle(self.current_steering)
            return
        
        try:
            # Apply steering using ServoKit
            steering_angle = self.map_steering_to_angle(self.current_steering)
            self.servo_kit.servo[0].angle = steering_angle  # Channel 0
                
        except Exception as e:
            logger.error(f"Steering control error: {e}")
    
    def center_steering(self):
        """Center the steering servo"""
        if SERVO_KIT_AVAILABLE and self.servo_kit:
            try:
                self.servo_kit.servo[0].angle = 90  # Center position
                logger.info("Steering centered to 90 degrees")
            except Exception as e:
                logger.error(f"Error centering steering: {e}")
    
    def cleanup(self):
        """Clean up hardware resources"""
        if SERVO_KIT_AVAILABLE and self.servo_kit:
            try:
                self.center_steering()
                logger.info("Steering hardware resources cleaned up")
            except Exception as e:
                logger.error(f"Error during steering cleanup: {e}")
    
    def get_status(self):
        """Get current steering status"""
        return {
            'steering': self.current_steering,
            'servo_kit_available': SERVO_KIT_AVAILABLE,
            'servo_kit_initialized': self.servo_kit is not None
        }
