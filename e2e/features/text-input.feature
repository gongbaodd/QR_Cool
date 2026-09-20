Feature: Step 1 — text input
  The first step collects one line of text or a website address.
  Websites derive the mask letter from their name; plain text starts
  from a blank full-canvas region.

  Background:
    Given the editor is open

  Scenario: A website address derives the mask letter
    When I enter "http://ABCD.com" in the text field
    And I continue to the mask search step
    Then the mask search field shows "A"

  Scenario: Editing the input re-derives the mask letter
    Given I continue to the mask search step
    And I go back to the step "Step 1 Input text"
    When I enter "www.XYZ.com" in the text field
    And I continue to the mask search step
    Then the mask search field shows "X"

  Scenario: Plain text starts from a blank region
    When I enter "just some words" in the text field
    Then I see the message "Plain text — step 2 starts from a blank full-canvas region."

  Scenario: Example buttons populate the input
    When I click the example button "Use example Hello"
    Then the text field shows "Hello QR / COOL"
    When I click the example button "Use example Website"
    Then the text field shows "https://example.com"
    And I continue to the mask search step
    Then the mask search field shows "E"

  Scenario: A multi-line text is rejected
    When I enter the multi-line text
      """
      line
      line
      """
    Then I see the message "Use one line only."
    And the continue button is disabled

  Scenario: The blank option starts an editable poster without an upload
    When I continue to the mask search step
    And I pick the mask font "blank"
    Then the mask font "blank" is selected
    And I see the message "1000 × 1000"
    When I continue to the adjust step
    Then the poster canvas is visible
    And the "Continue to generate" button is enabled
