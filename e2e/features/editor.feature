Feature: SVG preview and assembly
  Reusable preview assets stay stable while placement is edited. Assembly is the
  explicit boundary for exact placement checks and final rendering.

  Background:
    Given the editor has a committed QR

  Scenario: Placement nudges and keyboard controls keep the SVG scene available
    When I nudge the QR right
    And I adjust the QR size and angle from the keyboard
    Then the SVG placement scene remains visible
    And I see the message "Assemble to check placement and render the final poster."

  Scenario: Marker styling opens its native dialog from an SVG hit target
    When I open the top-left marker settings
    Then the marker dialog is visible
    When I press "Escape"
    Then the marker dialog is closed

  Scenario: A blank region can be assembled and returned to editing
    When I assemble the poster
    Then the assembled poster is visible
    And the preview and download link share one blob URL
    When I return to editing
    Then the SVG placement scene remains visible
