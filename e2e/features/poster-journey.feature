Feature: Assemble and download the poster
  The pipeline runs entirely client-side: the render API no longer exists,
  the preview and the download share one object URL of the assembled Blob,
  and editing the text afterwards invalidates the result.

  Background:
    Given the editor is open
    And I finished the first two steps

  Scenario: Edit, assemble, download, and invalidate
    # nudge controls move the QR without needing numeric inputs
    When I click "Move right"
    # keyboard arrow moves via canvas focus
    And I press "ArrowLeft" on the poster canvas
    # pattern settings are reachable in step 3 and keep the step valid
    And I choose "Dot" in the "Pixel style" option group
    And I set the error correction level to "H"
    And I set the error correction level back to "M"
    When I continue to generate
    And I assemble the poster
    Then I see the message "Artistic margins can affect scanning."
    And no render API was called
    # Preview and download must share one object URL of the assembled Blob (no re-encode)
    And the preview and download link share one blob URL
    When I download the poster as "poster.png"
    Then the download is a 1000x1000 PNG
    # Editing the text again invalidates the assembled poster
    When I click "Return to editing"
    And I click "Back to adjust"
    And I go back to the step "Step 1 Input text"
    And I enter "new content" in the text field
    Then the download link disappears
    And the remaining steps validate again
    # A multi-line text is rejected even on the second pass
    When I go back to the step "Step 1 Input text"
    And I enter the multi-line text
      """
      line
      line
      """
    Then I see the message "Use one line only."
    And the continue button is disabled
