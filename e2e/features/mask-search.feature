@icons
Feature: Step 2 — mask search
  The mask step shows a 3x4 grid of fonts from public/fonts, a live preview
  canvas, and an icon gallery served by the mocked /api/icons proxy.
  Tests never make paid calls; every scenario below uses the mock.

  Background:
    Given the editor is open
    And I continue to the mask search step

  Scenario: The mask keeps a 3x4 font grid, first-letter rule and icon search
    When I search for "QR"
    Then the preview canvas has bright pixels
    And the mask options list exactly 12 fonts
    When I pick the mask font "Fathead"
    Then the mask font "Fathead" is selected
    # A term that has not been searched yet offers a search
    When I search for "heart"
    And I open the icon gallery
    Then I see the message "Found 20 icons for “heart”"
    And the gallery shows the icon "Gallery icon heart-0"
    And the icon search sent exactly the query "heart"
    # Closing the modal returns to the mask preview and keeps the cached term
    When I close the icon gallery
    And I open the icon gallery again
    # The cached term reopens the same results without a new request
    And I pick the gallery icon "Gallery icon heart-15"
    Then the preview canvas is visible
    And the sidebar keeps its 12 fonts and exactly one selected option

  Scenario: The mask search field keeps 10 characters at most
    When I search for "123456789012345"
    Then the mask search field shows "1234567890"

  Scenario: A one-character query searches and opens the gallery
    When I search for "Z"
    Then the button "More icons" says "search Z"
    When I open the icon gallery
    Then I see the message "Found 20 icons for “Z”"
    And the gallery shows the icon "Gallery icon Z-0"
    And the icon search sent exactly the query "Z"

  Scenario: An empty search input never fetches icons
    # The field starts from the derived letter, so clear it first
    When I search for ""
    Then the button "More icons" says "search icons"
    And I see the message "Type a letter or word to search icons."
    When I click "More icons"
    Then the preview canvas is visible
    And the icon search sent exactly the query ""

  Scenario: The icon modal dismisses on Escape and on a backdrop click
    When I search for "heart"
    And I open the icon gallery
    # Esc is the platform close request
    And I press "Escape"
    Then the preview canvas is visible
    # A click on the backdrop is a light dismiss; the cached term stays searchable
    When I open the icon gallery
    And I click at the top-left corner of the page
    Then the preview canvas is visible
    And I see the message "Found 20 icons for “heart”"
    And the icon search sent exactly the query "heart"

  Scenario: Re-entering step 2 refreshes the search control from the input
    When I search for "heart"
    And I open the icon gallery
    And I close the icon gallery
    And I continue to the adjust step
    And I go back to the step "Step 2 Mask Search"
    Then the preview canvas is visible
    And the button "More icons" says "more — 20 icons"
    And I see the message "Found 20 icons for “heart”"
    # Editing the input re-derives the label from the field and hides the stale count
    When I search for "star"
    Then the button "More icons" says "search star"
    And I do not see the message "Found 20 icons for “heart”"
    # The next click searches the new term and shows its icons
    When I open the icon gallery
    Then the gallery shows the icon "Gallery icon star-0"
    And I see the message "Found 20 icons for “star”"
    And the icon search sent exactly the queries "heart, star"

  Scenario: The fill tool toggles and can be dismissed
    # A blank canvas fill is disabled until a letter mask is chosen
    Then the "Fill region" button is disabled
    When I pick the mask font "Fathead"
    And I click "Fill region"
    Then the "Fill region" button is pressed
    And I see the message "Click inside an enclosed area to fill it."
    When I press "Escape"
    Then the "Fill region" button is not pressed
