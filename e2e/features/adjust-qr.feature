Feature: Step 3 — adjust the QR
  The QR is positioned with nudge buttons, keyboard arrows and mouse drags.
  Pattern settings (ecc, pixel style, marker shapes, rim, seed) are reachable
  in this step and must keep the step valid after every change.

  Background:
    Given the editor is open
    And I finished the first two steps

  Scenario: Marker settings open from the canvas and expose marker options
    When I choose "Dot" in the "Pixel style" option group
    And I open the finder marker dialog from the top-left marker
    Then the "Marker shape" option group is visible
    And I choose "Octagon" in the "Marker shape" option group
    Then the option "octagon Octagon" is checked
    And I choose "Plus" in the "Marker inner" option group
    Then the option "plus Plus" is checked
    And I close the marker dialog
    When I open the sub marker dialog from the bottom-right marker
    Then the "Sub marker" option group is visible
    And I choose "Round" in the "Sub marker" option group
    Then the "circle Circle" option in the "Sub marker" option group is checked
    And I close the marker dialog

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
