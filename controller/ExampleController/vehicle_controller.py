from dataclasses import dataclass

# Use the example hardware-capable controllers
from ExampleController.throttle_control import ThrottleController
from ExampleController.steering_control import SteeringController


@dataclass
class VehicleController:
    """Minimal vehicle controller that directly drives GPIO via example controllers.

    Only throttle (forward/backward) and steering are supported.
    Safety gates are configured once on init: throttle lock held, emergency brake released,
    and power lock disabled so movement is permitted without extra inputs.
    """

    def __post_init__(self) -> None:
        self.throttle = ThrottleController()
        self.steering = SteeringController()
        # Configure safety gates to allow motion
        try:
            self.throttle.update_emergency_brake(False)
            self.throttle.update_throttle_lock(True)
            self.throttle.update_power_lock(False)
        except Exception:
            pass

    def update(self, throttle_cmd: float, steering_cmd: float) -> None:
        # Clamp inputs to [-1, 1]
        t = max(-1.0, min(1.0, float(throttle_cmd)))
        s = max(-1.0, min(1.0, float(steering_cmd)))
        # Update controllers
        self.throttle.set_throttle(t)
        self.steering.set_steering(s)
        # Apply to hardware
        self.throttle.apply_throttle()
        self.steering.apply_steering()

    def stop(self) -> None:
        try:
            self.throttle.stop_vehicle()
            self.steering.center_steering()
        except Exception:
            pass

    def cleanup(self) -> None:
        try:
            self.throttle.cleanup()
            self.steering.cleanup()
        except Exception:
            pass


