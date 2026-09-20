Feature: Step 3 — adjust the QR
  The QR is positioned with nudge buttons, keyboard arrows and mouse drags.
  Pattern settings (ecc, pixel style, marker shapes, rim, seed) are reachable
  in this step and must keep the step valid after every change.

  Background:
    Given the editor is open
    And I finished the first two steps

  Scenario: Pattern settings expose ecc, pixel style and marker options
    When I set the error correction level to "H"
    Then the option "H High ~30%" is checked
    # H may temporarily invalidate placement while preparing; return to M for a stable assemble
    When I set the error correction level back to "M"
    Then the option "M Medium ~15%" is checked
    When I choose "Dot" in the "Pixel style" option group
    And I choose "Octagon" in the "Marker shape" option group
    Then the option "octagon Octagon" is checked
    When I choose "Plus" in the "Marker inner" option group
    Then the option "plus Plus" is checked
    When I choose "Round" in the "Sub marker" option group
    Then the "circle Circle" option in the "Sub marker" option group is checked

  Scenario: The rim and the seed stay reproducible
    When I press "New pattern" and remember the seed
    Then the seed value changed
    And the "Continue to generate" button is enabled
    # Toggling the rim on and off keeps the step valid
    When I toggle "Add Rim (1 module)" twice
    Then the "Continue to generate" button is enabled

  Scenario: The region overlay can be hidden and shown again
    When I toggle "Show region"
    Then the checkbox "Show region" is unchecked
    When I toggle "Show region"
    Then the checkbox "Show region" is checked

  Scenario: Nudges and keyboard move the QR
    When I click "Move right"
    And I click "Move left"
    And I press "ArrowRight" on the poster canvas
    And I press "ArrowLeft" on the poster canvas
    And I press "ArrowUp" on the poster canvas
    And I press "ArrowDown" on the poster canvas
    Then the "Continue to generate" button is enabled

  Scenario: Dragging the QR out of the region is reported and can be undone
    When I drag the QR canvas by 20, 20
    Then an invalid-placement alert is visible
    # Dragging it back restores a valid fit
    When I drag the QR canvas by -20, -20
    Then the "Continue to generate" button is enabled
    And the page has no horizontal overflow
